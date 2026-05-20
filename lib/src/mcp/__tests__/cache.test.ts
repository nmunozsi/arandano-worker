import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyGitnexusCache } from '../cache.js';

vi.mock('../../gates/_shell.js', () => ({
  runShell: vi.fn(),
}));
import { runShell } from '../../gates/_shell.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gn-verify-'));
  vi.mocked(runShell).mockReset();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const mockShell = (mocks: Array<{ exitCode: number; output: string }>): void => {
  let i = 0;
  vi.mocked(runShell).mockImplementation(async () => ({
    passed: (mocks[i] ?? { exitCode: 1 }).exitCode === 0,
    exitCode: (mocks[i] ?? { exitCode: 1 }).exitCode,
    output: (mocks[i++] ?? { output: '' }).output,
    durationMs: 0,
  }));
};

describe('verifyGitnexusCache', () => {
  it('returns "skipped" when gitnexus binary missing', async () => {
    mockShell([{ exitCode: 1, output: '' }]);
    expect(await verifyGitnexusCache(dir)).toBe('skipped');
  });

  it('returns "missing" when .gitnexus/ directory absent', async () => {
    mockShell([{ exitCode: 0, output: '/usr/bin/gitnexus' }]);
    expect(await verifyGitnexusCache(dir)).toBe('missing');
  });

  it('returns "missing" when stamp file absent', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    mockShell([
      { exitCode: 0, output: '/usr/bin/gitnexus' },
      { exitCode: 0, output: 'abc\n' },
    ]);
    expect(await verifyGitnexusCache(dir)).toBe('missing');
  });

  it('returns "cache-hit" when stamp matches HEAD', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', '.head-stamp'), 'abc123', 'utf8');
    mockShell([
      { exitCode: 0, output: '/usr/bin/gitnexus' },
      { exitCode: 0, output: 'abc123\n' },
    ]);
    expect(await verifyGitnexusCache(dir)).toBe('cache-hit');
  });

  it('returns "stale" when stamp mismatches HEAD', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    await writeFile(join(dir, '.gitnexus', '.head-stamp'), 'old', 'utf8');
    mockShell([
      { exitCode: 0, output: '/usr/bin/gitnexus' },
      { exitCode: 0, output: 'new\n' },
    ]);
    expect(await verifyGitnexusCache(dir)).toBe('stale');
  });

  it('never spawns "gitnexus analyze" under any path', async () => {
    await mkdir(join(dir, '.gitnexus'), { recursive: true });
    mockShell([
      { exitCode: 0, output: '/usr/bin/gitnexus' },
      { exitCode: 0, output: 'sha\n' },
    ]);
    await verifyGitnexusCache(dir);
    const calls = vi.mocked(runShell).mock.calls.map(([opts]) => opts as { cmd: string; args?: string[] });
    expect(calls.some((c) => c.cmd === 'gitnexus' && (c.args ?? []).includes('analyze'))).toBe(false);
  });
});
