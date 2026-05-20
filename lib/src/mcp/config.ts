import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface McpServerEntry {
  command: string;
  args: string[];
}

const KNOWN_SERVERS: Record<string, McpServerEntry> = {
  gitnexus: { command: 'gitnexus', args: ['mcp'] },
};

/**
 * Writes a Claude Code MCP config at `<workspaceRoot>/.claude/mcp.json`.
 * Returns the workspace-relative path to the written file.
 */
export async function writeMcpConfig(workspaceRoot: string, servers: string[]): Promise<string> {
  const entries: Record<string, McpServerEntry> = {};
  for (const name of servers) {
    const entry = KNOWN_SERVERS[name];
    if (entry) entries[name] = entry;
  }

  const relPath = '.claude/mcp.json';
  const absPath = join(workspaceRoot, relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, JSON.stringify({ mcpServers: entries }, null, 2) + '\n', 'utf8');
  return relPath;
}
