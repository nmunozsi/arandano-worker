import { runShell } from '../_shell.js';
export const lintGate = (cwd: string) =>
  runShell({ cmd: 'ruff', args: ['check', '.'], cwd });
