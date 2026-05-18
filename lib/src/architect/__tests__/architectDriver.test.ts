import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePlanContext, buildArchitectPrompt } from '../architectDriver.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'arch-driver-'));
  // Clear env vars before each test
  delete process.env['ARANDANO_PLAN_CONTEXT_JSON'];
  delete process.env['ARANDANO_PLAN_CONTEXT_PATH'];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env['ARANDANO_PLAN_CONTEXT_JSON'];
  delete process.env['ARANDANO_PLAN_CONTEXT_PATH'];
});

const FIXTURE_CONTEXT = {
  planSlug: 'smoke',
  defaultBranch: 'main',
  tasks: [
    { id: 'T1', branch: 'agent/T1-1234', prUrl: 'https://github.com/org/repo/pull/1' },
    { id: 'T2', branch: 'agent/T2-5678' },
  ],
};

describe('resolvePlanContext', () => {
  it('parses ARANDANO_PLAN_CONTEXT_JSON when set', async () => {
    process.env['ARANDANO_PLAN_CONTEXT_JSON'] = JSON.stringify(FIXTURE_CONTEXT);
    const ctx = await resolvePlanContext();
    expect(ctx?.planSlug).toBe('smoke');
    expect(ctx?.tasks).toHaveLength(2);
    expect(ctx?.tasks[0]?.branch).toBe('agent/T1-1234');
  });

  it('falls back to reading ARANDANO_PLAN_CONTEXT_PATH when JSON env var absent', async () => {
    const contextFile = join(dir, 'plan-context.json');
    await writeFile(contextFile, JSON.stringify(FIXTURE_CONTEXT));
    process.env['ARANDANO_PLAN_CONTEXT_PATH'] = contextFile;
    // Use original cwd; pass dir as the workspace root for the test
    const ctx = await resolvePlanContext(dir);
    expect(ctx?.planSlug).toBe('smoke');
    expect(ctx?.tasks).toHaveLength(2);
  });

  it('prefers ARANDANO_PLAN_CONTEXT_JSON over ARANDANO_PLAN_CONTEXT_PATH', async () => {
    process.env['ARANDANO_PLAN_CONTEXT_JSON'] = JSON.stringify({ ...FIXTURE_CONTEXT, planSlug: 'from-json' });
    const contextFile = join(dir, 'plan-context.json');
    await writeFile(contextFile, JSON.stringify({ ...FIXTURE_CONTEXT, planSlug: 'from-file' }));
    process.env['ARANDANO_PLAN_CONTEXT_PATH'] = contextFile;
    const ctx = await resolvePlanContext(dir);
    expect(ctx?.planSlug).toBe('from-json');
  });

  it('returns null when both env vars are absent', async () => {
    const ctx = await resolvePlanContext();
    expect(ctx).toBeNull();
  });

  it('returns null (no crash) when ARANDANO_PLAN_CONTEXT_JSON is malformed', async () => {
    process.env['ARANDANO_PLAN_CONTEXT_JSON'] = '{not valid json';
    const ctx = await resolvePlanContext();
    expect(ctx).toBeNull();
  });

  it('returns null (no crash) when ARANDANO_PLAN_CONTEXT_PATH file is missing', async () => {
    process.env['ARANDANO_PLAN_CONTEXT_PATH'] = join(dir, 'does-not-exist.json');
    const ctx = await resolvePlanContext(dir);
    expect(ctx).toBeNull();
  });
});

describe('buildArchitectPrompt', () => {
  it('includes branch and pr URL lines when context has tasks', () => {
    const prompt = buildArchitectPrompt('smoke', 'main', FIXTURE_CONTEXT);
    expect(prompt).toContain('agent/T1-1234');
    expect(prompt).toContain('https://github.com/org/repo/pull/1');
    expect(prompt).toContain('agent/T2-5678');
  });

  it('shows fallback message when context is null', () => {
    const prompt = buildArchitectPrompt('smoke', 'main', null);
    expect(prompt).toContain('no task context available');
  });

  it('shows fallback message when context has empty tasks list', () => {
    const prompt = buildArchitectPrompt('smoke', 'main', { ...FIXTURE_CONTEXT, tasks: [] });
    expect(prompt).toContain('no task context available');
  });

  it('does not contain "git log" (merge range removed)', () => {
    const prompt = buildArchitectPrompt('smoke', 'main', FIXTURE_CONTEXT);
    expect(prompt).not.toContain('git log');
  });

  it('retains architect: no-op detection instruction', () => {
    const prompt = buildArchitectPrompt('smoke', 'main', null);
    expect(prompt).toContain('architect: no-op');
  });
});

// Existing test retained
describe('architectDriver no-op detection', () => {
  it('matches "architect: no-op" regardless of case and surrounding text', () => {
    const re = /architect:\s*no-op/i;
    expect(re.test('done, architect: no-op, exiting')).toBe(true);
    expect(re.test('ARCHITECT:    NO-OP')).toBe(true);
    expect(re.test('architect ok')).toBe(false);
  });
});
