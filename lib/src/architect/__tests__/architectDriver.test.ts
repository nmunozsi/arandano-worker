import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePlanContext, buildArchitectPrompt, architectMain } from '../architectDriver.js';

vi.mock('../../gates/_shell.js', () => ({ runShell: vi.fn() }));
vi.mock('../../git.js', () => ({ git: vi.fn(), createBranch: vi.fn() }));
vi.mock('../../invokeClaudeCode.js', () => ({ invokeCli: vi.fn() }));
vi.mock('../../writeResult.js', () => ({ writeJournal: vi.fn(), writeResult: vi.fn() }));
vi.mock('../../openPr.js', () => ({ openPr: vi.fn() }));

import { runShell } from '../../gates/_shell.js';
import { git, createBranch } from '../../git.js';
import { invokeCli } from '../../invokeClaudeCode.js';
import { writeJournal, writeResult } from '../../writeResult.js';
import * as cacheModule from '../../mcp/cache.js';
import * as registryModule from '../../mcp/registry.js';
import * as configModule from '../../mcp/config.js';

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

  it('falls back to file when ARANDANO_PLAN_CONTEXT_JSON is malformed but file is valid', async () => {
    process.env['ARANDANO_PLAN_CONTEXT_JSON'] = '{not valid json';
    const contextFile = join(dir, 'plan-context.json');
    await writeFile(contextFile, JSON.stringify(FIXTURE_CONTEXT));
    process.env['ARANDANO_PLAN_CONTEXT_PATH'] = contextFile;
    const ctx = await resolvePlanContext(dir);
    expect(ctx?.planSlug).toBe('smoke');
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

// Shared harness setup for architectMain() integration tests
function setupArchitectEnv() {
  process.env['ARANDANO_TASK_ID'] = 'T-architect';
  process.env['ARANDANO_RUN_FOLDER'] = 'run-test';
  process.env['ARANDANO_CLI'] = 'claude';
  process.env['ARANDANO_MODEL'] = 'claude-opus-4-5';
}

function teardownArchitectEnv() {
  delete process.env['ARANDANO_TASK_ID'];
  delete process.env['ARANDANO_RUN_FOLDER'];
  delete process.env['ARANDANO_CLI'];
  delete process.env['ARANDANO_MODEL'];
  delete process.env['ARANDANO_MCP_SERVERS'];
}

function setupInfrastructureMocks() {
  const shellResult = { passed: true, exitCode: 0, output: '', durationMs: 0 };
  vi.mocked(runShell).mockResolvedValue(shellResult);
  vi.mocked(git).mockResolvedValue(undefined as never);
  vi.mocked(createBranch).mockResolvedValue(undefined);
  vi.mocked(invokeCli).mockResolvedValue({ exitCode: 0, output: 'architect: no-op' });
  vi.mocked(writeJournal).mockResolvedValue(undefined);
  vi.mocked(writeResult).mockResolvedValue(undefined);
}

describe('architectMain — MCP wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setupArchitectEnv();
    setupInfrastructureMocks();
    delete process.env['ARANDANO_MCP_SERVERS'];
  });

  afterEach(() => {
    teardownArchitectEnv();
  });

  it('passes --mcp-config to invokeCli when ARANDANO_MCP_SERVERS=gitnexus and cache is hit', async () => {
    process.env['ARANDANO_MCP_SERVERS'] = 'gitnexus';
    vi.spyOn(cacheModule, 'verifyGitnexusCache').mockResolvedValue('cache-hit');
    const registrySpy = vi.spyOn(registryModule, 'writeRegistryEntry').mockResolvedValue(undefined);
    const configSpy = vi
      .spyOn(configModule, 'writeMcpConfig')
      .mockResolvedValue('.claude/mcp.json');

    await architectMain();

    expect(registrySpy).toHaveBeenCalledWith(expect.any(String));
    expect(configSpy).toHaveBeenCalledWith(expect.any(String), ['gitnexus']);
    expect(vi.mocked(invokeCli)).toHaveBeenCalledWith(
      expect.objectContaining({ mcpConfigPath: '.claude/mcp.json' }),
    );
  });

  it('does NOT pass --mcp-config when ARANDANO_MCP_SERVERS is absent', async () => {
    const registrySpy = vi.spyOn(registryModule, 'writeRegistryEntry');
    const configSpy = vi.spyOn(configModule, 'writeMcpConfig');

    await architectMain();

    expect(registrySpy).not.toHaveBeenCalled();
    expect(configSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invokeCli)).toHaveBeenCalledWith(
      expect.not.objectContaining({ mcpConfigPath: expect.anything() }),
    );
  });

  it('does NOT pass --mcp-config when verifyGitnexusCache returns "stale"', async () => {
    process.env['ARANDANO_MCP_SERVERS'] = 'gitnexus';
    vi.spyOn(cacheModule, 'verifyGitnexusCache').mockResolvedValue('stale');
    const configSpy = vi.spyOn(configModule, 'writeMcpConfig');

    await architectMain();

    expect(configSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invokeCli)).toHaveBeenCalledWith(
      expect.not.objectContaining({ mcpConfigPath: expect.anything() }),
    );
  });

  it('does NOT pass --mcp-config when verifyGitnexusCache returns "missing"', async () => {
    process.env['ARANDANO_MCP_SERVERS'] = 'gitnexus';
    vi.spyOn(cacheModule, 'verifyGitnexusCache').mockResolvedValue('missing');
    const configSpy = vi.spyOn(configModule, 'writeMcpConfig');

    await architectMain();

    expect(configSpy).not.toHaveBeenCalled();
    expect(vi.mocked(invokeCli)).toHaveBeenCalledWith(
      expect.not.objectContaining({ mcpConfigPath: expect.anything() }),
    );
  });
});
