import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, normalize } from 'node:path';

let fakeHome: string;
let realHome: string;
beforeEach(async () => {
  fakeHome = await mkdtemp(join(tmpdir(), 'gn-home-'));
  realHome = homedir();
  process.env['HOME'] = fakeHome;
  process.env['USERPROFILE'] = fakeHome;
  vi.resetModules();
});
afterEach(async () => {
  await rm(fakeHome, { recursive: true, force: true });
  process.env['HOME'] = realHome;
  process.env['USERPROFILE'] = realHome;
});

type RegistryEntry = { path: string; name: string; storagePath: string };

describe('writeRegistryEntry', () => {
  it('creates ~/.gitnexus/registry.json with a single repo entry on first call', async () => {
    const { writeRegistryEntry: fn } = await import('../registry.js');
    await fn('/workspace/foo');
    const raw = await readFile(join(fakeHome, '.gitnexus', 'registry.json'), 'utf8');
    const reg = JSON.parse(raw) as RegistryEntry[];
    expect(reg).toHaveLength(1);
    expect(reg[0]?.path).toBe('/workspace/foo');
    expect(reg[0]?.name).toBe('foo');
    expect(reg[0]?.storagePath).toBe(join('/workspace/foo', '.gitnexus'));
  });

  it('is idempotent — second call updates timestamp but does not duplicate', async () => {
    const { writeRegistryEntry: fn } = await import('../registry.js');
    await fn('/workspace/foo');
    await fn('/workspace/foo');
    const raw = await readFile(join(fakeHome, '.gitnexus', 'registry.json'), 'utf8');
    const reg = JSON.parse(raw) as RegistryEntry[];
    expect(reg).toHaveLength(1);
  });

  it('overwrites a malformed registry without throwing', async () => {
    const { writeRegistryEntry: fn } = await import('../registry.js');
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(fakeHome, '.gitnexus'), { recursive: true });
    await writeFile(join(fakeHome, '.gitnexus', 'registry.json'), '{not valid json', 'utf8');
    await expect(fn('/workspace/foo')).resolves.toBeUndefined();
    const raw = await readFile(join(fakeHome, '.gitnexus', 'registry.json'), 'utf8');
    const reg = JSON.parse(raw) as RegistryEntry[];
    expect(reg).toHaveLength(1);
  });
});
