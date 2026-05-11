import { runShell } from '../_shell.js';
export const formatGate = (cwd: string) =>
  runShell({ cmd: 'ruff', args: ['format', '--check', '.'], cwd });
