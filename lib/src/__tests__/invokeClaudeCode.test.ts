import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invokeCli } from '../invokeClaudeCode.js';

describe('event envelope', () => {
  it('events file lines are JSON {ts:number, e:object}', async () => {
    const dir = join(tmpdir(), `test-envelope-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ ts: 100, e: { type: 'system', subtype: 'init' } }),
        JSON.stringify({
          ts: 200,
          e: {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read' }] },
          },
        }),
      ].join('\n'),
      'utf8',
    );
    const raw = await readFile(eventsPath, 'utf8');
    expect(raw.split('\n').every((l) => !l || JSON.parse(l).e !== undefined)).toBe(true);
  });
});

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
