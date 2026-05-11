import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeCli } from '../invokeClaudeCode.js';

describe('invokeCli', () => {
  it('passes the prompt via stdin and returns exit code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fake-cli-'));
    const script = join(dir, 'fake-cli.js');
    await writeFile(
      script,
      `const fs = require('fs');
const buf = fs.readFileSync(0, 'utf8');
process.stdout.write('PROMPT=' + buf);
process.exit(0);
`,
    );
    try {
      const r = await invokeCli({
        cli: process.execPath,
        args: [script],
        prompt: 'hello world',
        cwd: dir,
        env: { ...process.env, ARANDANO_TASK_ID: 'T1' },
      });
      expect(r.exitCode).toBe(0);
      expect(r.output).toContain('PROMPT=hello world');
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
