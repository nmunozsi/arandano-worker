import { runShell } from './_shell.js';
export const securityGate = (cwd: string) =>
  runShell({ cmd: 'npm', args: ['audit', '--audit-level=high'], cwd });
