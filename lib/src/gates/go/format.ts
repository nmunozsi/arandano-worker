import { runShell } from '../_shell.js';
export const formatGate = (cwd: string) =>
  runShell({ cmd: 'gofmt', args: ['-l', '.'], cwd });
