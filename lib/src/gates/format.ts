import { runShell } from './_shell.js';
export const formatGate = (cwd: string) =>
  runShell({ cmd: 'npx', args: ['prettier', '--check', '.'], cwd });
