import { runShell } from '../_shell.js';
export const coverageGate = (cwd: string) =>
  runShell({ cmd: 'go', args: ['test', '-coverprofile=coverage.out', './...'], cwd });
