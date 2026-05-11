import { runShell } from '../_shell.js';
export const securityGate = (cwd: string) =>
  runShell({ cmd: 'govulncheck', args: ['./...'], cwd });
