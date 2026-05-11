import { runShell } from './_shell.js';
export const coverageGate = (cwd: string) =>
  runShell({ cmd: 'npx', args: ['vitest', 'run', '--coverage'], cwd });
