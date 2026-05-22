import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliEvents } from '../driver.js';

describe('parseCliEvents', () => {
  it('counts tool_use events in a valid jsonl file', async () => {
    const dir = join(tmpdir(), `test-events-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ type: 'system', subtype: 'init' }),
        JSON.stringify({ type: 'tool_use', name: 'Read', input: {} }),
        JSON.stringify({ type: 'tool_result', content: '' }),
        JSON.stringify({ type: 'tool_use', name: 'Edit', input: {} }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'done' }),
      ].join('\n'),
      'utf8',
    );
    expect(await parseCliEvents(eventsPath)).toBe(2);
  });

  it('returns 0 when the file does not exist', async () => {
    expect(await parseCliEvents('/nonexistent/path/cli-events.jsonl')).toBe(0);
  });

  it('returns 0 when the file is empty', async () => {
    const dir = join(tmpdir(), `test-events-empty-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(eventsPath, '', 'utf8');
    expect(await parseCliEvents(eventsPath)).toBe(0);
  });

  it('skips malformed json lines gracefully', async () => {
    const dir = join(tmpdir(), `test-events-bad-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        'not valid json{{{',
        JSON.stringify({ type: 'tool_use', name: 'Bash', input: {} }),
        '{"type":',
      ].join('\n'),
      'utf8',
    );
    expect(await parseCliEvents(eventsPath)).toBe(1);
  });
});
