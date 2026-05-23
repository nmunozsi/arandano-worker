import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface PhaseRecord {
  phase: string;
  ms: number;
}

export interface TimingsFile {
  task_id: string;
  stack?: string;
  image?: string;
  host?: Record<string, number>;
  worker?: Record<string, number>;
  total_ms: number;
  cli_tool_calls?: number;
  cli_commits?: number;
  cli_budget_exceeded?: boolean;
  cli_input_tokens?: number;
  cli_output_tokens?: number;
  cli_cache_read_tokens?: number;
  cli_cache_creation_tokens?: number;
  cli_tool_timings?: Record<string, { count: number; total_ms: number }>;
  gates_parallel_ms?: number;
  gates_serial_sum_ms?: number;
}

export class PerfRecorder {
  private readonly recs: PhaseRecord[] = [];

  start(phase: string): () => void {
    const startNs = process.hrtime.bigint();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const ms = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
      this.recs.push({ phase, ms });
    };
  }

  records(): PhaseRecord[] {
    return [...this.recs];
  }

  asObject(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.recs) out[r.phase] = (out[r.phase] ?? 0) + r.ms;
    return out;
  }

  totalMs(): number {
    return this.recs.reduce((a, r) => a + r.ms, 0);
  }

  async writeTimingsJson(
    path: string,
    opts: { taskId: string; side: 'host' | 'worker'; stack?: string; image?: string },
  ): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const payload: TimingsFile = {
      task_id: opts.taskId,
      total_ms: this.totalMs(),
    };
    if (opts.stack !== undefined) payload.stack = opts.stack;
    if (opts.image !== undefined) payload.image = opts.image;
    payload[opts.side] = this.asObject();
    await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  }
}

/** Read a timings.json file written by either side, returning null on missing file. */
export async function readTimingsJson(path: string): Promise<TimingsFile | null> {
  try {
    const txt = await readFile(path, 'utf8');
    return JSON.parse(txt) as TimingsFile;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
