import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runShell } from '../gates/_shell.js';
import { git, createBranch } from '../git.js';
import { invokeCli } from '../invokeClaudeCode.js';
import { openPr } from '../openPr.js';
import { writeJournal, writeResult } from '../writeResult.js';
import { verifyGitnexusCache } from '../mcp/cache.js';
import { writeRegistryEntry } from '../mcp/registry.js';
import { writeMcpConfig } from '../mcp/config.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

export interface PlanContextTask {
  id: string;
  branch: string;
  prUrl?: string;
}

export interface PlanContext {
  planSlug: string;
  defaultBranch: string;
  tasks: PlanContextTask[];
}

/**
 * Resolves plan context using priority: inline JSON env var → file path → null.
 * @param workspaceRoot  Base directory for resolving ARANDANO_PLAN_CONTEXT_PATH.
 *                       Defaults to process.cwd().
 */
export async function resolvePlanContext(
  workspaceRoot = process.cwd(),
): Promise<PlanContext | null> {
  const inlineJson = process.env['ARANDANO_PLAN_CONTEXT_JSON'];
  if (inlineJson) {
    try {
      return JSON.parse(inlineJson) as PlanContext;
    } catch {
      // malformed — try file
    }
  }
  const contextPath = process.env['ARANDANO_PLAN_CONTEXT_PATH'];
  if (contextPath) {
    try {
      const raw = await readFile(resolve(workspaceRoot, contextPath), 'utf8');
      return JSON.parse(raw) as PlanContext;
    } catch {
      // file unreadable — fall back to null
    }
  }
  return null;
}

export function buildArchitectPrompt(
  planSlug: string,
  defaultBranch: string,
  planContext: PlanContext | null,
): string {
  const taskLines =
    planContext?.tasks.length
      ? planContext.tasks
          .map((t) => `  - ${t.id}: branch=${t.branch}${t.prUrl ? ` pr=${t.prUrl}` : ''}`)
          .join('\n')
      : '  (no task context available — read plan files only)';

  return [
    `You are running as the architect role.`,
    `Read /opt/arandano/skills/architect/SKILL.md and apply minimal edits to docs/architecture.md.`,
    `The plan slug is "${planSlug}".`,
    `Coder tasks in this plan:`,
    taskLines,
    `For each task you may run:`,
    `  gh pr diff <prUrl>                                              (preferred)`,
    `  git fetch origin <branch> --depth=1 && git diff ${defaultBranch}...<branch>  (fallback)`,
    `Only fetch what you need. If no architectural change applies, print exactly "architect: no-op" and exit without committing.`,
    `Otherwise make ONE commit with subject ":memo: docs(arch): refresh after ${planSlug}".`,
  ].join('\n');
}

export async function architectMain(): Promise<number> {
  const workspace = process.cwd();
  const taskId = env('ARANDANO_TASK_ID');
  const runFolder = env('ARANDANO_RUN_FOLDER');
  const cli = env('ARANDANO_CLI');
  const model = env('ARANDANO_MODEL');
  const planSlug = process.env['ARANDANO_PLAN_SLUG'] ?? 'plan';
  const startedAt = new Date().toISOString();

  const cfgRaw = await runShell({
    cmd: 'cat',
    args: ['.arandano/config.yaml'],
    cwd: workspace,
  });
  const defaultBranch = /default_branch:\s*([\w./-]+)/.exec(cfgRaw.output)?.[1] ?? 'main';
  await git(['checkout', defaultBranch], workspace).catch(() => {});

  const branch = `agent/${taskId}-${Date.now()}`;
  await createBranch(workspace, branch, defaultBranch);

  // MCP wiring — soft-fail if cache isn't ready. Orchestrator pre-warms on host (T3).
  let mcpConfigPath: string | undefined;
  let mcpJournalLine = '';
  const requestedServers = (process.env['ARANDANO_MCP_SERVERS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (requestedServers.includes('gitnexus')) {
    const cacheResult = await verifyGitnexusCache(workspace);
    mcpJournalLine = `gitnexus: ${cacheResult}\n`;
    if (cacheResult === 'cache-hit') {
      await writeRegistryEntry(workspace);
      mcpConfigPath = await writeMcpConfig(workspace, ['gitnexus']);
    }
  }

  const planContext = await resolvePlanContext(workspace);
  const prompt = buildArchitectPrompt(planSlug, defaultBranch, planContext);

  const cliRun = await invokeCli({
    cli,
    args: ['--print', '--dangerously-skip-permissions', '--model', model],
    prompt,
    cwd: workspace,
    env: process.env,
    ...(mcpConfigPath ? { mcpConfigPath } : {}),
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
      mcpJournalLine +
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
  await writeJournal(bodyPath, `Architecture refresh for plan \`${planSlug}\`.`);
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
