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
}

export async function runGates(opts: {
  gates: Record<GateName, GateDef>;
  order: GateName[];
}): Promise<RunGatesResult> {
  const results = {} as RunGatesResult['results'];
  let firstFailure: GateName | undefined;
  for (const name of opts.order) {
    const def = opts.gates[name];
    if (def.mode === 'skip') continue;
    const r = await def.run();
    results[name] = {
      passed: r.passed,
      mode: def.mode,
      output: r.output,
      durationMs: r.durationMs,
    };
    if (!r.passed && def.mode === 'required') {
      firstFailure = name;
      break;
    }
  }
  return { passed: !firstFailure, firstFailure, results };
}
