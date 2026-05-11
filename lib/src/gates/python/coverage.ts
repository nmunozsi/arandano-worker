import { runShell } from '../_shell.js';
export const coverageGate = (cwd: string) =>
  runShell({ cmd: 'pytest', args: ['--cov=src', '--cov-fail-under=80'], cwd });
