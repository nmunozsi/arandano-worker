import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import yaml from 'yaml';
import { readTask } from './readTask.js';
import { git, commitSubjects, createBranch, currentBranch } from './git.js';
import { detectRedGreen } from './tdd.js';
import { invokeCli } from './invokeClaudeCode.js';
import { runGates } from './runGates.js';
import { runShell } from './gates/_shell.js';
import * as nodeGates from './gates/index.js';
import { commitMsgGate } from './gates/commitMsg.js';
import { openPr } from './openPr.js';
import { writeJournal, writeResult } from './writeResult.js';
import { PerfRecorder } from './perf.js';

export async function buildContextBlock(workdir: string, paths: string[]): Promise<string> {
  const blocks: string[] = [];
  for (const rel of paths) {
    try {
      const content = await readFile(join(workdir, rel), 'utf8');
      blocks.push(`\`\`\`${rel}\n${content}\n\`\`\``);
    } catch {
      // silently skip missing files
    }
  }
  return blocks.length > 0
    ? `<injected-context>\n${blocks.join('\n\n')}\n</injected-context>\n\n`
    : '';
}

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

export async function parseCliEvents(eventsPath: string): Promise<number> {
  try {
    const txt = await readFile(eventsPath, 'utf8');
    const events = txt
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as { type: string };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as { type: string }[];
    return events.filter((e) => e.type === 'tool_use').length;
  } catch {
    return 0;
  }
}

export async function countBranchCommits(workspace: string, baseBranch: string): Promise<number> {
  try {
    const r = await runShell({
      cmd: 'git',
      args: ['log', '--oneline', `${baseBranch}..HEAD`],
      cwd: workspace,
    });
    return r.output.trim() === '' ? 0 : r.output.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export async function main(): Promise<number> {
  const workspace = process.cwd();
  const perf = new PerfRecorder();

  const roleMd = process.env['ARANDANO_ROLE_MD'] ?? '';
  if (roleMd.endsWith('reviewer.md')) {
    const { reviewerMain } = await import('./reviewer/reviewerDriver.js');
    return reviewerMain();
  }
  if (roleMd.endsWith('architect.md') || process.env['ARANDANO_TASK_ID'] === 'T-architect') {
    const { architectMain } = await import('./architect/architectDriver.js');
    return architectMain();
  }

  const taskId = env('ARANDANO_TASK_ID');
  const taskMdRel = env('ARANDANO_TASK_MD');
  const cli = env('ARANDANO_CLI');
  const model = env('ARANDANO_MODEL');
  const tdd = env('ARANDANO_TDD') as 'strict' | 'relaxed';
  const runFolder = env('ARANDANO_RUN_FOLDER');
  const quality = JSON.parse(env('ARANDANO_QUALITY_JSON')) as {
    format: 'required' | 'warn' | 'skip';
    lint: 'required' | 'warn' | 'skip';
    typecheck: 'required' | 'warn' | 'skip';
    test: 'required' | 'warn' | 'skip';
    coverage: { min: number; delta: 'nonneg' | 'any' };
    security: 'required' | 'warn' | 'skip';
    commit_msg: 'conventional' | 'freeform' | 'skip';
  };

  const startedAt = new Date().toISOString();
  const journal: string[] = [`# Run ${taskId} @ ${startedAt}`, ''];
  const log = (line: string) => {
    journal.push(line);
    console.log(line);
  };

  const cfgRaw = await readFile(join(workspace, '.arandano', 'config.yaml'), 'utf8').catch(
    () => 'project:\n  stack: node-ts\n',
  );
  const cfg = yaml.parse(cfgRaw) as { project?: { stack?: string; default_branch?: string } };
  const stack = cfg.project?.stack ?? 'node-ts';
  const defaultBranch = cfg.project?.default_branch ?? 'main';

  // checkout phase: reset to base branch, load stack gates, read task, create agent branch
  const stopCheckout = perf.start('checkout');

  // A prior failed run may have left the workspace on an agent branch — reset to base.
  // Use defaultBranch directly (not currentBranch()) to avoid the git HEAD race when
  // multiple containers share the same workspace directory.
  await git(['checkout', defaultBranch], workspace).catch(() => {});

  const stackGates =
    stack === 'python'
      ? await import('./gates/python/index.js')
      : stack === 'go'
        ? await import('./gates/go/index.js')
        : nodeGates;

  const task = await readTask({ workspace, taskMdRel });
  log(`task: ${task.id} — ${task.title}`);

  const baseBranch = defaultBranch;
  const branch = `agent/${task.id}-${task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)}`;
  await createBranch(workspace, branch, baseBranch);
  log(`branch: ${branch} (base ${baseBranch})`);

  stopCheckout();

  const stopInstall = perf.start('install');
  const install = await (stack === 'python'
    ? runShell({ cmd: 'pip', args: ['install', '-r', 'requirements.txt'], cwd: workspace })
    : stack === 'go'
      ? runShell({ cmd: 'go', args: ['mod', 'download'], cwd: workspace })
      : runShell({ cmd: 'npm', args: ['install'], cwd: workspace }));
  stopInstall();
  log(`install exit=${install.exitCode}`);
  if (!install.passed) {
    return await fail({ workspace, runFolder, taskId, branch, journal, startedAt, reason: 'install_failure', perf, stack, baseBranch });
  }

  const injectPaths = (process.env['ARANDANO_INJECT_CONTEXT'] ?? '').split(':').filter(Boolean);
  const contextBlock = await buildContextBlock(workspace, injectPaths);

  const promptBody = [
    `You are running as the ${task.role} role.`,
    `Read .arandano/roles/${task.role}.md, src/CONTEXT.md, planning/memory/coding-standards.md.`,
    `Read the SKILL.md at /opt/arandano/skills/gitmoji-commits/SKILL.md and follow its commit format on every commit you produce.`,
    `Task file: ${task.filePath}.`,
    `Use TDD (${tdd}). Every commit MUST follow the gitmoji-commits skill format.`,
    `Do not push or open the PR yourself — the worker will after gates pass.`,
  ].join('\n');
  const prompt = contextBlock + promptBody;
  const eventsPath = join(workspace, '.arandano', 'runs', runFolder, 'cli-events.jsonl');
  const stopCli = perf.start('cli');
  let cliRun = await invokeCli({
    cli,
    args: ['--print', '--dangerously-skip-permissions', '--model', model, '--output-format', 'stream-json'],
    prompt,
    cwd: workspace,
    env: process.env,
    eventsPath,
  });
  // Fallback: if the CLI doesn't support --output-format stream-json, retry without it
  if (
    cliRun.exitCode === 1 &&
    (cliRun.output.includes('unknown flag') || cliRun.output.includes('unrecognized'))
  ) {
    log('[warn] stream-json unavailable, retrying without --output-format');
    cliRun = await invokeCli({
      cli,
      args: ['--print', '--dangerously-skip-permissions', '--model', model],
      prompt,
      cwd: workspace,
      env: process.env,
    });
  }
  stopCli();
  log(`cli exit=${cliRun.exitCode}`);
  if (cliRun.output) log(cliRun.output.slice(0, 2000));

  const cliBudgetMs = process.env['ARANDANO_CLI_BUDGET_MS']
    ? Number(process.env['ARANDANO_CLI_BUDGET_MS'])
    : undefined;
  const actualCliMs = perf.asObject()['cli'] ?? 0;
  const cliBudgetExceeded = cliBudgetMs !== undefined && actualCliMs > cliBudgetMs;
  if (cliBudgetExceeded) {
    log(
      `[arandano] cli_budget_ms exceeded: actual=${actualCliMs}ms budget=${cliBudgetMs}ms`,
    );
  }

  if (cliRun.exitCode !== 0) {
    return await fail({
      workspace,
      runFolder,
      taskId,
      branch,
      journal,
      startedAt,
      reason: 'cli_failure',
      perf,
      stack,
      eventsPath,
      baseBranch,
      cliBudgetExceeded,
    });
  }

  if (tdd === 'strict') {
    const subjects = await commitSubjects(workspace, baseBranch);
    const r = detectRedGreen(subjects);
    if (!r.ok) {
      log(`tdd violation: ${r.reason ?? '<none>'}`);
      return await fail({
        workspace,
        runFolder,
        taskId,
        branch,
        journal,
        startedAt,
        reason: 'tdd_violation',
        perf,
        stack,
        eventsPath,
        baseBranch,
        cliBudgetExceeded,
      });
    }
  }

  const gates = await runGates({
    order: ['format', 'lint', 'typecheck', 'test', 'coverage', 'security', 'commitMsg'],
    gates: {
      format: {
        mode: quality.format,
        run: async () => {
          const stop = perf.start('gate.format');
          try { return await stackGates.formatGate(workspace); } finally { stop(); }
        },
      },
      lint: {
        mode: quality.lint,
        run: async () => {
          const stop = perf.start('gate.lint');
          try { return await stackGates.lintGate(workspace); } finally { stop(); }
        },
      },
      typecheck: {
        mode: quality.typecheck,
        run: async () => {
          const stop = perf.start('gate.typecheck');
          try { return await stackGates.typecheckGate(workspace); } finally { stop(); }
        },
      },
      test: {
        mode: quality.test,
        run: async () => {
          const stop = perf.start('gate.test');
          try { return await stackGates.testGate(workspace); } finally { stop(); }
        },
      },
      coverage: {
        mode: 'warn',
        run: async () => {
          const stop = perf.start('gate.coverage');
          try { return await stackGates.coverageGate(workspace); } finally { stop(); }
        },
      },
      security: {
        mode: quality.security,
        run: async () => {
          const stop = perf.start('gate.security');
          try { return await stackGates.securityGate(workspace); } finally { stop(); }
        },
      },
      commitMsg: {
        mode: quality.commit_msg === 'skip' ? 'skip' : 'required',
        run: async () => {
          const stop = perf.start('gate.commitMsg');
          try { return await commitMsgGate(workspace, baseBranch); } finally { stop(); }
        },
      },
    },
  });

  log(
    `gates passed=${gates.passed}${gates.firstFailure ? ' firstFailure=' + gates.firstFailure : ''}`,
  );
  if (!gates.passed) {
    return await fail({
      workspace,
      runFolder,
      taskId,
      branch,
      journal,
      startedAt,
      reason: 'quality_violation',
      gates,
      perf,
      stack,
      eventsPath,
      baseBranch,
      cliBudgetExceeded,
    });
  }

  const bodyPath = join(workspace, '.arandano', 'runs', runFolder, 'pr-body.md');
  await writeJournal(bodyPath, [`Closes ${task.filePath}`, '', task.body].join('\n'));
  const stopPush = perf.start('push_and_pr');
  const pr = await openPr({
    cwd: workspace,
    baseBranch,
    branch,
    title: `[${task.id}] ${task.title}`,
    bodyPath,
  }).finally(() => stopPush());
  log(`pr: ${pr.url ?? '<none>'} passed=${pr.passed}`);
  if (!pr.passed && pr.output) log(`pr error: ${pr.output.slice(0, 1000)}`);

  await writeResult(join(workspace, '.arandano', 'runs', runFolder, 'result.json'), {
    task_id: taskId,
    branch,
    pr_url: pr.url ?? null,
    passed: pr.passed,
    tdd: { mode: tdd, ok: true },
    quality: Object.fromEntries(
      Object.entries(gates.results).map(([k, v]) => [k, { passed: v.passed }]),
    ),
    started_at: startedAt,
    ended_at: new Date().toISOString(),
  });
  await writeJournal(
    join(workspace, '.arandano', 'runs', runFolder, 'journal.md'),
    journal.join('\n'),
  );
  const timingsPath = join(workspace, '.arandano', 'runs', runFolder, 'timings.json');
  await perf.writeTimingsJson(timingsPath, {
    taskId,
    side: 'worker',
    stack,
  });

  const cliToolCalls = await parseCliEvents(eventsPath);
  const cliCommits = await countBranchCommits(workspace, baseBranch);
  await readFile(timingsPath, 'utf8')
    .then((raw) => {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed['cli_tool_calls'] = cliToolCalls;
      parsed['cli_commits'] = cliCommits;
      parsed['cli_budget_exceeded'] = cliBudgetExceeded;
      return writeFile(timingsPath, JSON.stringify(parsed, null, 2), 'utf8');
    })
    .catch(() => {});

  return pr.passed ? 0 : 1;
}

async function fail(opts: {
  workspace: string;
  runFolder: string;
  taskId: string;
  branch: string;
  journal: string[];
  startedAt: string;
  reason: string;
  gates?: Awaited<ReturnType<typeof runGates>>;
  perf?: PerfRecorder;
  stack?: string;
  eventsPath?: string;
  baseBranch?: string;
  cliBudgetExceeded?: boolean;
}): Promise<number> {
  if (opts.perf) {
    const timingsPath = join(opts.workspace, '.arandano', 'runs', opts.runFolder, 'timings.json');
    await opts.perf.writeTimingsJson(
      timingsPath,
      { taskId: opts.taskId, side: 'worker', stack: opts.stack },
    ).catch((e: unknown) => {
      console.warn('perf: failed to write timings.json:', e);
    });

    // Best-effort: patch timings.json with cli event counts and budget flag
    if (opts.eventsPath || opts.baseBranch || opts.cliBudgetExceeded !== undefined) {
      const cliToolCalls = opts.eventsPath ? await parseCliEvents(opts.eventsPath) : 0;
      const cliCommits =
        opts.baseBranch ? await countBranchCommits(opts.workspace, opts.baseBranch) : 0;
      await readFile(timingsPath, 'utf8')
        .then((raw) => {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          parsed['cli_tool_calls'] = cliToolCalls;
          parsed['cli_commits'] = cliCommits;
          parsed['cli_budget_exceeded'] = opts.cliBudgetExceeded ?? false;
          return writeFile(timingsPath, JSON.stringify(parsed, null, 2), 'utf8');
        })
        .catch(() => {});
    }
  }
  await writeResult(join(opts.workspace, '.arandano', 'runs', opts.runFolder, 'result.json'), {
    task_id: opts.taskId,
    branch: opts.branch,
    pr_url: null,
    passed: false,
    tdd: { mode: 'strict', ok: opts.reason !== 'tdd_violation' },
    quality: opts.gates
      ? Object.fromEntries(
          Object.entries(opts.gates.results).map(([k, v]) => [k, { passed: v.passed }]),
        )
      : {},
    started_at: opts.startedAt,
    ended_at: new Date().toISOString(),
  });
  await writeJournal(
    join(opts.workspace, '.arandano', 'runs', opts.runFolder, 'journal.md'),
    [`# Run ${opts.taskId}`, `failed: ${opts.reason}`, '', ...opts.journal].join('\n'),
  );
  return opts.reason === 'tdd_violation' ? 2 : opts.reason === 'quality_violation' ? 3 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main().then((code) => process.exit(code));
}
