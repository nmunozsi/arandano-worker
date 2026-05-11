import { describe, expect, it } from 'vitest';
import { runShell } from '../../gates/_shell.js';

describe('runShell', () => {
  it('captures stdout and reports passed=true on exit 0', async () => {
    const r = await runShell({
      cmd: 'node',
      args: ['-e', 'console.log("hi")'],
      cwd: process.cwd(),
    });
    expect(r.passed).toBe(true);
    expect(r.output).toContain('hi');
  });
  it('reports passed=false on non-zero exit', async () => {
    const r = await runShell({ cmd: 'node', args: ['-e', 'process.exit(3)'], cwd: process.cwd() });
    expect(r.passed).toBe(false);
  });
});
