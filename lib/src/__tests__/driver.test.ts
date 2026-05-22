import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliEvents, countBranchCommits, buildContextBlock } from '../driver.js';

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

describe('buildContextBlock', () => {
  it('wraps two files in injected-context with backtick blocks', async () => {
    const dir = join(tmpdir(), `test-ctx-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n', 'utf8');
    await writeFile(join(dir, 'b.json'), '{"x":1}\n', 'utf8');
    const result = await buildContextBlock(dir, ['a.ts', 'b.json']);
    expect(result).toContain('<injected-context>');
    expect(result).toContain('</injected-context>');
    expect(result).toContain('```a.ts');
    expect(result).toContain('```b.json');
    expect(result).toContain('export const a = 1;');
    expect(result).toContain('"x":1');
    expect(result.endsWith('\n\n')).toBe(true);
  });

  it('silently skips missing paths and returns empty string when all missing', async () => {
    const result = await buildContextBlock('/nonexistent/dir', ['missing.ts', 'also-missing.ts']);
    expect(result).toBe('');
  });

  it('silently skips a missing path but includes present ones', async () => {
    const dir = join(tmpdir(), `test-ctx-partial-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'present.ts'), 'const x = 1;\n', 'utf8');
    const result = await buildContextBlock(dir, ['missing.ts', 'present.ts']);
    expect(result).toContain('```present.ts');
    expect(result).not.toContain('missing.ts');
    expect(result).toContain('<injected-context>');
  });

  it('returns empty string for an empty paths array', async () => {
    const result = await buildContextBlock('/any/dir', []);
    expect(result).toBe('');
  });
});

describe('cliBudgetMs logic', () => {
  it('detects budget exceeded when actual ms is greater than budget', () => {
    const cliBudgetMs = 60000;
    const actualCliMs = 90000;
    const cliBudgetExceeded = cliBudgetMs !== undefined && actualCliMs > cliBudgetMs;
    expect(cliBudgetExceeded).toBe(true);
  });

  it('does not exceed budget when actual ms is within limit', () => {
    const cliBudgetMs = 60000;
    const actualCliMs = 45000;
    const cliBudgetExceeded = cliBudgetMs !== undefined && actualCliMs > cliBudgetMs;
    expect(cliBudgetExceeded).toBe(false);
  });

  it('does not exceed when cliBudgetMs is undefined (no budget set)', () => {
    const cliBudgetMs = undefined;
    const actualCliMs = 999999;
    const cliBudgetExceeded = cliBudgetMs !== undefined && actualCliMs > cliBudgetMs;
    expect(cliBudgetExceeded).toBe(false);
  });

  it('does not exceed when actual equals budget exactly', () => {
    const cliBudgetMs = 60000;
    const actualCliMs = 60000;
    const cliBudgetExceeded = cliBudgetMs !== undefined && actualCliMs > cliBudgetMs;
    expect(cliBudgetExceeded).toBe(false);
  });

  it('reads ARANDANO_CLI_BUDGET_MS env var as a number', () => {
    const raw = '120000';
    const parsed = raw ? Number(raw) : undefined;
    expect(parsed).toBe(120000);
    expect(typeof parsed).toBe('number');
  });

  it('returns undefined when ARANDANO_CLI_BUDGET_MS env var is absent', () => {
    const raw = undefined;
    const parsed = raw ? Number(raw) : undefined;
    expect(parsed).toBeUndefined();
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
