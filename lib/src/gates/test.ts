import { runShell } from './_shell.js';
export const testGate = (cwd: string) => runShell({ cmd: 'npx', args: ['vitest', 'run'], cwd });
