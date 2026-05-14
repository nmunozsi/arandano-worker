import { runShell } from './gates/_shell.js';

export async function openPr(opts: {
  cwd: string;
  baseBranch: string;
  branch: string;
  title: string;
  bodyPath: string;
}): Promise<{ url?: string; passed: boolean; output: string }> {
  // Force-push: agent branches are worker-owned and may exist on the remote
  // from a previous failed run with different history.
  const push = await runShell({
    cmd: 'git',
    args: ['push', '--force-with-lease', '-u', 'origin', opts.branch],
    cwd: opts.cwd,
  });
  if (!push.passed) return { passed: false, output: push.output };
  const create = await runShell({
    cmd: 'gh',
    args: [
      'pr',
      'create',
      '--base',
      opts.baseBranch,
      '--head',
      opts.branch,
      '--title',
      opts.title,
      '--body-file',
      opts.bodyPath,
    ],
    cwd: opts.cwd,
  });
  // If creation fails because a PR already exists for this branch, treat it as success.
  const alreadyExists =
    !create.passed && create.output.includes('already exists');
  if (!create.passed && !alreadyExists) return { passed: false, output: create.output };
  const view = await runShell({
    cmd: 'gh',
    args: ['pr', 'view', '--json', 'url', '-q', '.url'],
    cwd: opts.cwd,
  });
  return { passed: true, url: view.output.trim() || undefined, output: create.output };
}
