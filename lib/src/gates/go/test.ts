import { runShell } from '../_shell.js';
export const testGate = (cwd: string) =>
  runShell({ cmd: 'go', args: ['test', './...'], cwd });
