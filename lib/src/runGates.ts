import type { ShellResult } from './gates/_shell.js';

export type GateMode = 'required' | 'warn' | 'skip';
export interface GateDef {
  mode: GateMode;
  run: () => Promise<ShellResult>;
}
export type GateName =
  | 'format'
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'coverage'
  | 'security'
  | 'commitMsg';

export interface RunGatesResult {
  passed: boolean;
  firstFailure?: GateName;
  results: Record<
    GateName,
    { passed: boolean; mode: GateMode; output: string; durationMs: number }
  >;
  gates_parallel_ms: number;
  gates_serial_sum_ms: number;
}

const READ_ONLY: ReadonlyArray<GateName> = [
  'format',
  'lint',
  'typecheck',
  'test',
  'coverage',
  'security',
];

export async function runGates(opts: {
  gates: Record<GateName, GateDef>;
  order: GateName[];
  parallel?: boolean;
}): Promise<RunGatesResult> {
  const parallel = opts.parallel ?? true;
  const results = {} as RunGatesResult['results'];
  let firstFailure: GateName | undefined;
  const wallStart = Date.now();

  const recordResult = (name: GateName, def: GateDef, r: ShellResult): void => {
    results[name] = {
      passed: r.passed,
      mode: def.mode,
      output: r.output,
      durationMs: r.durationMs,
    };
    if (!r.passed && def.mode === 'required' && !firstFailure) firstFailure = name;
  };

  if (parallel) {
    // Run all read-only gates concurrently.
    const ro = opts.order.filter(
      (n) => READ_ONLY.includes(n) && opts.gates[n]?.mode !== 'skip',
    ) as GateName[];
    const settled = await Promise.all(
      ro.map(async (name) => {
        const def = opts.gates[name];
        return { name, def, r: await def.run() };
      }),
    );
    for (const { name, def, r } of settled) recordResult(name, def, r);

    // Run commitMsg serially last (if present and not skip).
    const cm = opts.order.find((n) => n === 'commitMsg');
    if (cm && opts.gates[cm]?.mode !== 'skip') {
      const def = opts.gates[cm];
      const r = await def.run();
      recordResult(cm, def, r);
    }
  } else {
    // Sequential, fail-fast — pre-Phase-4 behavior.
    for (const name of opts.order) {
      const def = opts.gates[name];
      if (!def || def.mode === 'skip') continue;
      const r = await def.run();
      recordResult(name, def, r);
      if (!r.passed && def.mode === 'required') break;
    }
  }

  const gates_parallel_ms = Date.now() - wallStart;
  const gates_serial_sum_ms = Object.values(results).reduce((a, r) => a + r.durationMs, 0);

  return { passed: !firstFailure, firstFailure, results, gates_parallel_ms, gates_serial_sum_ms };
}
