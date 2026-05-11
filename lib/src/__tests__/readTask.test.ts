import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTask } from '../readTask.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'aw-readtask-'));
  return async () => rm(dir, { recursive: true, force: true });
});

describe('readTask', () => {
  it('parses the task MD pointed to by env', async () => {
    await mkdir(join(dir, '.arandano', 'tasks'), { recursive: true });
    const tp = join(dir, '.arandano', 'tasks', 'T1-foo.md');
    await writeFile(tp, '---\nid: T1\ntitle: foo\nrole: coder\n---\nbody');
    const t = await readTask({ workspace: dir, taskMdRel: '.arandano/tasks/T1-foo.md' });
    expect(t.id).toBe('T1');
    expect(t.title).toBe('foo');
    expect(t.body).toContain('body');
  });

  it('throws when the file does not exist', async () => {
    await expect(readTask({ workspace: dir, taskMdRel: 'missing.md' })).rejects.toThrow(/missing/);
  });
});
