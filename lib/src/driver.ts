import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import yaml from 'yaml';
import { readTask } from './readTask.js';
import { commitSubjects, createBranch, currentBranch } from './git.js';
import { detectRedGreen } from './tdd.js';
import { invokeCli } from './invokeClaudeCode.js';
import { runGates } from './runGates.js';
import { runShell } from './gates/_shell.js';
import * as nodeGates from './gates/index.js';
import { commitMsgGate } from './gates/commitMsg.js';
import { openPr } from './openPr.js';
import { writeJournal, writeResult } from './writeResult.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

export async function main(): Promise<number> {
  const workspace = process.cwd();

  const roleMd = process.env['ARANDANO_ROLE_MD'] ?? '';
  if (roleMd.endsWith('reviewer.md')) {
    const { reviewerMain } = await import('./reviewer/reviewerDriver.js');
    return reviewerMain();
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
  const cfg = yaml.parse(cfgRaw) as { project?: { stack?: string } };
  const stack = cfg.project?.stack ?? 'node-ts';

  const stackGates =
    stack === 'python'
      ? await import('./gates/python/index.js')
      : stack === 'go'
        ? await import('./gates/go/index.js')
        : nodeGates;

  const task = await readTask({ workspace, taskMdRel });
  log(`task: ${task.id} — ${task.title}`);

  const baseBranch = await currentBranch(workspace);
  const branch = `agent/${task.id}-${task.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)}`;
  await createBranch(workspace, branch, baseBranch);
  log(`branch: ${branch} (base ${baseBranch})`);

  const install = await (stack === 'python'
    ? runShell({ cmd: 'pip', args: ['install', '-r', 'requirements.txt'], cwd: workspace })
    : stack === 'go'
      ? runShell({ cmd: 'go', args: ['mod', 'download'], cwd: workspace })
      : runShell({ cmd: 'npm', args: ['install'], cwd: workspace }));
  log(`install exit=${install.exitCode}`);
  if (!install.passed) {
    return await fail({ workspace, runFolder, taskId, branch, journal, startedAt, reason: 'install_failure' });
  }

  const prompt = [
    `You are running as the ${task.role} role.`,
    `Read .arandano/roles/${task.role}.md, src/CONTEXT.md, planning/memory/coding-standards.md.`,
    `Task file: ${task.filePath}.`,
    `Use TDD (${tdd}). Make conventional commits.`,
    `Do not push or open the PR yourself — the worker will after gates pass.`,
  ].join('\n');
  const cliRun = await invokeCli({
    cli,
    args: ['--print', '--dangerously-skip-permissions', '--model', model],
    prompt,
    cwd: workspace,
    env: process.env,
  });
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
      });
    }
  }

  const gates = await runGates({
    order: ['format', 'lint', 'typecheck', 'test', 'coverage', 'security', 'commitMsg'],
    gates: {
      format: { mode: quality.format, run: () => stackGates.formatGate(workspace) },
      lint: { mode: quality.lint, run: () => stackGates.lintGate(workspace) },
      typecheck: { mode: quality.typecheck, run: () => stackGates.typecheckGate(workspace) },
      test: { mode: quality.test, run: () => stackGates.testGate(workspace) },
      coverage: { mode: 'warn', run: () => stackGates.coverageGate(workspace) },
      security: { mode: quality.security, run: () => stackGates.securityGate(workspace) },
      commitMsg: {
        mode: quality.commit_msg === 'skip' ? 'skip' : 'required',
        run: () => commitMsgGate(workspace, baseBranch),
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
    });
  }

  const bodyPath = join(workspace, '.arandano', 'runs', runFolder, 'pr-body.md');
  await writeJournal(bodyPath, [`Closes ${task.filePath}`, '', task.body].join('\n'));
  const pr = await openPr({
    cwd: workspace,
    baseBranch,
    branch,
    title: `[${task.id}] ${task.title}`,
    bodyPath,
  });
  log(`pr: ${pr.url ?? '<none>'} passed=${pr.passed}`);

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
}): Promise<number> {
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
