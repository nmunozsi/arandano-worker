import { runShell } from '../_shell.js';
export const lintGate = (cwd: string) =>
  runShell({ cmd: 'golangci-lint', args: ['run'], cwd });
