import { join } from 'node:path';
import { runShell } from '../gates/_shell.js';
import { git, createBranch } from '../git.js';
import { invokeCli } from '../invokeClaudeCode.js';
import { openPr } from '../openPr.js';
import { writeJournal, writeResult } from '../writeResult.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

export async function architectMain(): Promise<number> {
  const workspace = process.cwd();
  const taskId = env('ARANDANO_TASK_ID');
  const runFolder = env('ARANDANO_RUN_FOLDER');
  const cli = env('ARANDANO_CLI');
  const model = env('ARANDANO_MODEL');
  const planSlug = process.env['ARANDANO_PLAN_SLUG'] ?? 'plan';
  const mergeRange = process.env['ARANDANO_PLAN_MERGE_RANGE'] ?? '';
  const startedAt = new Date().toISOString();

  // Reset to the default branch then create the architect branch.
  const cfgRaw = await runShell({
    cmd: 'cat',
    args: ['.arandano/config.yaml'],
    cwd: workspace,
  });
  const defaultBranch = /default_branch:\s*([\w./-]+)/.exec(cfgRaw.output)?.[1] ?? 'main';
  await git(['checkout', defaultBranch], workspace).catch(() => {});

  const branch = `agent/${taskId}-${Date.now()}`;
  await createBranch(workspace, branch, defaultBranch);

  const prompt = [
    `You are running as the architect role.`,
    `Read /opt/arandano/skills/architect/SKILL.md and apply minimal edits to docs/architecture.md.`,
    `The plan slug is "${planSlug}". The merged commit range is "${mergeRange}".`,
    `Inspect: docs/architecture.md (current), the plan files under docs/ or .arandano/specs/, and "git log ${mergeRange}".`,
    `If no architectural change applies, print exactly "architect: no-op" and exit without committing.`,
    `Otherwise make ONE commit with subject ":memo: docs(arch): refresh after ${planSlug}".`,
  ].join('\n');

  const cliRun = await invokeCli({
    cli,
    args: ['--print', '--dangerously-skip-permissions', '--model', model],
    prompt,
    cwd: workspace,
    env: process.env,
  });

  const noopMarker = /architect:\s*no-op/i.test(cliRun.output ?? '');
  const diff = await runShell({
    cmd: 'git',
    args: ['diff', '--name-only', defaultBranch, '--', 'docs/architecture.md'],
    cwd: workspace,
  });
  const changed = diff.output.trim().length > 0;

  if (!changed || noopMarker) {
    await writeJournal(
      join(workspace, '.arandano', 'runs', runFolder, 'journal.md'),
      [
        `architect: no-op`,
        `cli output (first 500 chars): ${(cliRun.output ?? '').slice(0, 500)}`,
      ].join('\n'),
    );
    await writeResult(join(workspace, '.arandano', 'runs', runFolder, 'result.json'), {
      task_id: taskId,
      branch,
      pr_url: null,
      passed: true,
      tdd: { mode: 'relaxed', ok: true },
      quality: {},
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      architect: 'no-op',
    } as never);
    return 0;
  }

  const bodyPath = join(workspace, '.arandano', 'runs', runFolder, 'pr-body.md');
  await writeJournal(
    bodyPath,
    [`Architecture refresh for plan \`${planSlug}\`.`, '', `Merge range: \`${mergeRange}\``].join(
      '\n',
    ),
  );
  const pr = await openPr({
    cwd: workspace,
    baseBranch: defaultBranch,
    branch,
    title: `:memo: docs(arch): refresh after ${planSlug}`,
    bodyPath,
  });

  await writeResult(join(workspace, '.arandano', 'runs', runFolder, 'result.json'), {
    task_id: taskId,
    branch,
    pr_url: pr.url ?? null,
    passed: pr.passed,
    tdd: { mode: 'relaxed', ok: true },
    quality: {},
    started_at: startedAt,
    ended_at: new Date().toISOString(),
  });
  return pr.passed ? 0 : 1;
}
