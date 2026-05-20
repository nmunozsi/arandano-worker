import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runShell } from '../gates/_shell.js';

export type CacheResult = 'cache-hit' | 'stale' | 'missing' | 'skipped';

const STAMP_REL_PATH = '.gitnexus/.head-stamp';

async function gitnexusOnPath(): Promise<boolean> {
  const r = await runShell({ cmd: 'which', args: ['gitnexus'], cwd: process.cwd() });
  return r.exitCode === 0;
}

async function currentHead(workspaceRoot: string): Promise<string | null> {
  const r = await runShell({ cmd: 'git', args: ['rev-parse', 'HEAD'], cwd: workspaceRoot });
  if (r.exitCode !== 0) return null;
  return r.output.trim();
}

/**
 * Verify the host has already prepared `.gitnexus/` for this workspace.
 * NEVER runs analyze. Returns the cache state so the caller can decide.
 */
export async function verifyGitnexusCache(workspaceRoot: string): Promise<CacheResult> {
  const onPath = await gitnexusOnPath();
  process.stderr.write(`[cache] gitnexusOnPath=${onPath} cwd=${workspaceRoot}\n`);
  if (!onPath) return 'skipped';

  const gnDir = join(workspaceRoot, '.gitnexus');
  const dirExists = existsSync(gnDir);
  process.stderr.write(`[cache] .gitnexus exists(${gnDir})=${dirExists}\n`);
  if (!dirExists) return 'missing';

  const head = await currentHead(workspaceRoot);
  process.stderr.write(`[cache] currentHead=${head}\n`);
  if (!head) return 'skipped';

  const stampPath = join(workspaceRoot, STAMP_REL_PATH);
  const stampExists = existsSync(stampPath);
  process.stderr.write(`[cache] stamp exists(${stampPath})=${stampExists}\n`);
  if (!stampExists) return 'missing';
  try {
    const stamp = (await readFile(stampPath, 'utf8')).trim();
    process.stderr.write(`[cache] stamp=${stamp} head=${head} match=${stamp === head}\n`);
    return stamp === head ? 'cache-hit' : 'stale';
  } catch (e) {
    process.stderr.write(`[cache] readFile threw: ${(e as Error).message}\n`);
    return 'missing';
  }
}
