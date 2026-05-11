import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { z } from 'zod';

const Schema = z.object({
  id: z.string(),
  title: z.string(),
  role: z.string(),
  cli: z.string().optional(),
  model: z.string().optional(),
  tdd: z.enum(['strict', 'relaxed']).optional(),
});

export interface WorkerTask {
  id: string;
  title: string;
  role: string;
  body: string;
  filePath: string;
}

export async function readTask(opts: {
  workspace: string;
  taskMdRel: string;
}): Promise<WorkerTask> {
  const filePath = join(opts.workspace, opts.taskMdRel);
  const text = await readFile(filePath, 'utf8');
  const { data, content } = matter(text);
  const parsed = Schema.parse(data);
  return { id: parsed.id, title: parsed.title, role: parsed.role, body: content, filePath };
}
