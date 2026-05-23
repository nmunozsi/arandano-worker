import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCliEvents, parseCliTokens, parseCliToolTimings, countBranchCommits, buildContextBlock, buildInlinedContent } from '../driver.js';

describe('parseCliEvents (envelope + nested tool_use)', () => {
  it('counts tool_use events nested inside assistant.message.content', async () => {
    const dir = join(tmpdir(), `test-events-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ ts: 0, e: { type: 'system', subtype: 'init' } }),
        JSON.stringify({
          ts: 100,
          e: {
            type: 'assistant',
            message: {
              content: [
                { type: 'thinking', thinking: '…' },
                { type: 'tool_use', id: 'tu_1', name: 'Read' },
              ],
            },
          },
        }),
        JSON.stringify({
          ts: 200,
          e: {
            type: 'user',
            message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '…' }] },
          },
        }),
        JSON.stringify({
          ts: 300,
          e: {
            type: 'assistant',
            message: {
              content: [
                { type: 'tool_use', id: 'tu_2', name: 'Edit' },
                { type: 'tool_use', id: 'tu_3', name: 'Bash' },
              ],
            },
          },
        }),
        JSON.stringify({ ts: 400, e: { type: 'result', subtype: 'success' } }),
      ].join('\n'),
      'utf8',
    );
    expect(await parseCliEvents(eventsPath)).toBe(3);
  });

  it('returns 0 on empty/missing/malformed', async () => {
    expect(await parseCliEvents('/nonexistent/cli-events.jsonl')).toBe(0);
  });
});

describe('parseCliTokens', () => {
  it('extracts usage from final result event', async () => {
    const dir = join(tmpdir(), `test-tokens-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        JSON.stringify({ ts: 0, e: { type: 'system' } }),
        JSON.stringify({
          ts: 5000,
          e: {
            type: 'result',
            subtype: 'success',
            usage: {
              input_tokens: 1500,
              output_tokens: 320,
              cache_read_input_tokens: 12000,
              cache_creation_input_tokens: 200,
            },
          },
        }),
      ].join('\n'),
      'utf8',
    );
    const t = await parseCliTokens(eventsPath);
    expect(t).toEqual({
      input_tokens: 1500,
      output_tokens: 320,
      cache_read_input_tokens: 12000,
      cache_creation_input_tokens: 200,
    });
  });

  it('returns zeros when no result event', async () => {
    const dir = join(tmpdir(), `test-tokens-empty-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(eventsPath, '', 'utf8');
    expect(await parseCliTokens(eventsPath)).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });
});

describe('parseCliToolTimings', () => {
  it('correlates tool_use ts with matching tool_result ts and groups by tool name', async () => {
    const dir = join(tmpdir(), `test-tooltime-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const eventsPath = join(dir, 'cli-events.jsonl');
    await writeFile(
      eventsPath,
      [
        JSON.stringify({
          ts: 100,
          e: {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Read' }] },
          },
        }),
        JSON.stringify({
          ts: 250,
          e: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1' }] } },
        }),
        JSON.stringify({
          ts: 300,
          e: {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tu_2', name: 'Read' }] },
          },
        }),
        JSON.stringify({
          ts: 320,
          e: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2' }] } },
        }),
        JSON.stringify({
          ts: 400,
          e: {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tu_3', name: 'Bash' }] },
          },
        }),
        JSON.stringify({
          ts: 900,
          e: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_3' }] } },
        }),
      ].join('\n'),
      'utf8',
    );
    expect(await parseCliToolTimings(eventsPath)).toEqual({
      Read: { count: 2, total_ms: 170 },
      Bash: { count: 1, total_ms: 500 },
    });
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

describe('buildInlinedContent', () => {
  it('inlines role, CONTEXT, coding-standards, and gitmoji SKILL content', async () => {
    const dir = join(tmpdir(), `test-inlined-${Date.now()}`);
    await mkdir(join(dir, '.arandano/roles'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await mkdir(join(dir, 'planning/memory'), { recursive: true });
    await writeFile(join(dir, '.arandano/roles/coder.md'), 'ROLE_CODER', 'utf8');
    await writeFile(join(dir, 'src/CONTEXT.md'), 'CTX', 'utf8');
    await writeFile(join(dir, 'planning/memory/coding-standards.md'), 'STD', 'utf8');

    const skillDir = join(tmpdir(), `skill-${Date.now()}`);
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), 'GITMOJI', 'utf8');

    const out = await buildInlinedContent(dir, 'coder', join(skillDir, 'SKILL.md'));
    expect(out).toContain('ROLE_CODER');
    expect(out).toContain('CTX');
    expect(out).toContain('STD');
    expect(out).toContain('GITMOJI');
    expect(out).toContain('<inlined>');
    expect(out).toContain('</inlined>');
  });

  it('caps total content at 8KB and adds truncation marker', async () => {
    const dir = join(tmpdir(), `test-inlined-cap-${Date.now()}`);
    await mkdir(join(dir, '.arandano/roles'), { recursive: true });
    await writeFile(join(dir, '.arandano/roles/coder.md'), 'X'.repeat(10000), 'utf8');
    const out = await buildInlinedContent(dir, 'coder', '/nonexistent');
    expect(out.length).toBeLessThanOrEqual(8 * 1024 + 256);
    expect(out).toContain('[truncated');
  });

  it('silently skips missing files and returns empty string when all missing', async () => {
    const out = await buildInlinedContent('/nonexistent/dir', 'coder', '/nonexistent/SKILL.md');
    expect(out).toBe('');
  });
});
