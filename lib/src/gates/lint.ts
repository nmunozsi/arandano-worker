import { runShell } from './_shell.js';
export const lintGate = (cwd: string) =>
  runShell({ cmd: 'npx', args: ['eslint', '.', '--max-warnings=0'], cwd });
