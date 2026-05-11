import { runShell } from '../_shell.js';
export const typecheckGate = (cwd: string) =>
  runShell({ cmd: 'mypy', args: ['src'], cwd });
