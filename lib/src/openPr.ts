import { runShell } from './gates/_shell.js';

export async function openPr(opts: {
  cwd: string;
  baseBranch: string;
  branch: string;
  title: string;
  bodyPath: string;
}): Promise<{ url?: string; passed: boolean; output: string }> {
  const push = await runShell({
    cmd: 'git',
    args: ['push', '-u', 'origin', opts.branch],
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
  if (!create.passed) return { passed: false, output: create.output };
  const view = await runShell({
    cmd: 'gh',
    args: ['pr', 'view', '--json', 'url', '-q', '.url'],
    cwd: opts.cwd,
  });
  return { passed: true, url: view.output.trim() || undefined, output: create.output };
}
