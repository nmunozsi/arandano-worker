import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

// Spike (2026-05-20): registry.json is a top-level array, not { repos: [] }.
// Schema per gitnexus@1.6.5: [{ name, path, storagePath, indexedAt, lastCommit, stats }]
interface RegistryEntry {
  name: string;
  path: string;
  storagePath: string;
  indexedAt: string;
  lastCommit: string;
  stats?: Record<string, number>;
}

/**
 * Idempotently register the workspace in ~/.gitnexus/registry.json so
 * `gitnexus mcp` discovers it. Never throws — registry-poke failures are non-fatal.
 */
export async function writeRegistryEntry(workspaceRoot: string): Promise<void> {
  // Prefer env vars so tests can override USERPROFILE/HOME before calling.
  // os.homedir() on Windows uses the Win32 API and ignores process.env overrides.
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? homedir();
  const registryDir = join(home, '.gitnexus');
  const registryPath = join(registryDir, 'registry.json');
  try {
    await mkdir(registryDir, { recursive: true });

    let registry: RegistryEntry[] = [];
    if (existsSync(registryPath)) {
      try {
        const raw = await readFile(registryPath, 'utf8');
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          registry = parsed as RegistryEntry[];
        }
      } catch {
        // malformed — start with empty array
      }
    }

    const existingIdx = registry.findIndex((r) => r.path === workspaceRoot);
    const entry: RegistryEntry = {
      name: basename(workspaceRoot),
      path: workspaceRoot,
      storagePath: join(workspaceRoot, '.gitnexus'),
      indexedAt: new Date().toISOString(),
      lastCommit: '',
    };
    if (existingIdx >= 0) {
      registry[existingIdx] = { ...registry[existingIdx], ...entry };
    } else {
      registry.push(entry);
    }

    await writeFile(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  } catch {
    // soft-fail
  }
}
