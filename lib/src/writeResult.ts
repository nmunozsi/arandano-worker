import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface ResultJson {
  task_id: string;
  branch: string;
  pr_url: string | null;
  passed: boolean;
  tdd: { mode: 'strict' | 'relaxed'; ok: boolean; reason?: string };
  quality: Record<string, { passed: boolean; output_excerpt?: string }>;
  started_at: string;
  ended_at: string;
}

export async function writeResult(path: string, value: ResultJson): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

export async function writeJournal(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}
