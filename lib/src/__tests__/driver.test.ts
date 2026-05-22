import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliEvents, countBranchCommits } from '../driver.js';

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

describe('countBranchCommits', () => {
  it('returns 0 for an invalid/nonexistent workspace (error fallback)', async () => {
    const result = await countBranchCommits('/nonexistent/workspace/path', 'main');
    expect(result).toBe(0);
  });

  it('returns a number (not NaN) for a valid git repo with no extra commits', async () => {
    const { execSync } = await import('node:child_process');
    const dir = join(tmpdir(), `test-git-repo-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    // Init repo and make a base commit so HEAD..HEAD gives 0 extra commits
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });
    await writeFile(join(dir, 'README.md'), 'hello', 'utf8');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: dir, stdio: 'ignore' });
    const result = await countBranchCommits(dir, 'HEAD');
    expect(typeof result).toBe('number');
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });
});
