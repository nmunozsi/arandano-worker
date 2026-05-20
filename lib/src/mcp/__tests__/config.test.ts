import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeMcpConfig } from '../config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gn-config-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('writeMcpConfig', () => {
  it('writes a JSON file with the gitnexus server entry', async () => {
    const rel = await writeMcpConfig(dir, ['gitnexus']);
    expect(rel).toBe('.claude/mcp.json');
    const written = JSON.parse(await readFile(join(dir, rel), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(written.mcpServers['gitnexus']).toEqual({ command: 'gitnexus', args: ['mcp'] });
  });

  it('creates the .claude/ directory if missing', async () => {
    await writeMcpConfig(dir, ['gitnexus']);
    const s = await stat(join(dir, '.claude'));
    expect(s.isDirectory()).toBe(true);
  });

  it('omits unknown server names without throwing', async () => {
    await writeMcpConfig(dir, ['gitnexus', 'does-not-exist']);
    const written = JSON.parse(await readFile(join(dir, '.claude', 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(written.mcpServers)).toEqual(['gitnexus']);
  });
});
