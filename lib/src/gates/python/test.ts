import { runShell } from '../_shell.js';
export const testGate = (cwd: string) =>
  runShell({ cmd: 'pytest', args: [], cwd });
