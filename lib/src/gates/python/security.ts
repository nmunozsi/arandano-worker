import { runShell } from '../_shell.js';
export const securityGate = (cwd: string) =>
  runShell({ cmd: 'pip-audit', args: [], cwd });
