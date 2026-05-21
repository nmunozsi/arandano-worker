import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
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

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

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
    return await fail({ workspace, runFolder, taskId, branch, journal, startedAt, reason: 'install_failure', perf, stack });
  }

  const prompt = [
    `You are running as the ${task.role} role.`,
    `Read .arandano/roles/${task.role}.md, src/CONTEXT.md, planning/memory/coding-standards.md.`,
    `Read the SKILL.md at /opt/arandano/skills/gitmoji-commits/SKILL.md and follow its commit format on every commit you produce.`,
    `Task file: ${task.filePath}.`,
    `Use TDD (${tdd}). Every commit MUST follow the gitmoji-commits skill format.`,
    `Do not push or open the PR yourself — the worker will after gates pass.`,
  ].join('\n');
  const stopCli = perf.start('cli');
  const cliRun = await invokeCli({
    cli,
    args: ['--print', '--dangerously-skip-permissions', '--model', model],
    prompt,
    cwd: workspace,
    env: process.env,
  });
  stopCli();
  log(`cli exit=${cliRun.exitCode}`);
  if (cliRun.output) log(cliRun.output.slice(0, 2000));
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
  });
  stopPush();
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
  await perf.writeTimingsJson(join(workspace, '.arandano', 'runs', runFolder, 'timings.json'), {
    taskId,
    side: 'worker',
    stack,
  });
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
}): Promise<number> {
  if (opts.perf) {
    await opts.perf.writeTimingsJson(
      join(opts.workspace, '.arandano', 'runs', opts.runFolder, 'timings.json'),
      { taskId: opts.taskId, side: 'worker', stack: opts.stack },
    );
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
