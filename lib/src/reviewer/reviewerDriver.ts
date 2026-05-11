import { join } from 'node:path';
import { runShell } from '../gates/_shell.js';
import { applyChecklist } from './reviewChecklist.js';
import { writeJournal, writeResult } from '../writeResult.js';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env: ${k}`);
  return v;
};

export async function reviewerMain(): Promise<number> {
  const workspace = process.cwd();
  const taskId = env('ARANDANO_TASK_ID');
  const sourceTaskId = taskId.replace(/-review$/, '');
  const runFolder = env('ARANDANO_RUN_FOLDER');

  const prList = await runShell({
    cmd: 'gh',
    args: [
      'pr',
      'list',
      '--head',
      `agent/${sourceTaskId}-`,
      '--state',
      'open',
      '--json',
      'number,url,headRefName,body',
      '--limit',
      '1',
      '--search',
      sourceTaskId,
    ],
    cwd: workspace,
  });
  if (!prList.passed) return 1;

  const found = JSON.parse(prList.output || '[]') as Array<{ number: number; url: string }>;
  const pr = found[0];
  if (!pr) {
    await writeJournal(
      join(workspace, '.arandano', 'runs', runFolder, 'review.md'),
      `No PR found for ${sourceTaskId}`,
    );
    return 1;
  }

  const diff = await runShell({
    cmd: 'gh',
    args: ['pr', 'diff', String(pr.number)],
    cwd: workspace,
  });
  const result = applyChecklist({ diff: diff.output, contextRules: [] });

  const body = [
    `Review of #${pr.number} (${sourceTaskId}):`,
    '',
    ...(result.findings.length === 0
      ? ['No blockers found. Approving.']
      : result.findings.map(
          (f) => `- **${f.severity}** ${f.message}${f.excerpt ? ' — `' + f.excerpt + '`' : ''}`,
        )),
  ].join('\n');

  const action = result.decision === 'approve' ? '--approve' : '--request-changes';
  await runShell({
    cmd: 'gh',
    args: ['pr', 'review', String(pr.number), action, '--body', body],
    cwd: workspace,
  });

  await writeJournal(join(workspace, '.arandano', 'runs', runFolder, 'review.md'), body);
  await writeResult(join(workspace, '.arandano', 'runs', runFolder, 'result.json'), {
    task_id: taskId,
    branch: '',
    pr_url: pr.url,
    passed: result.decision === 'approve',
    tdd: { mode: 'relaxed', ok: true },
    quality: {},
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  });
  return result.decision === 'approve' ? 0 : 1;
}
