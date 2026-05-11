import { runShell } from './_shell.js';
export const commitMsgGate = (cwd: string, baseBranch: string) =>
  runShell({
    cmd: 'npx',
    args: ['commitlint', '--from', baseBranch, '--to', 'HEAD'],
    cwd,
  });
