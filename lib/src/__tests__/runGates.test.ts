import { describe, expect, it } from 'vitest';
import { runGates } from '../runGates.js';

describe('runGates serial (parallel=false)', () => {
  it('runs gates in order and stops on first required failure', async () => {
    const calls: string[] = [];
    const ok = (name: string) => async () => {
      calls.push(name);
      return { passed: true, exitCode: 0, output: '', durationMs: 1 };
    };
    const fail = (name: string) => async () => {
      calls.push(name);
      return { passed: false, exitCode: 1, output: 'boom', durationMs: 1 };
    };
    const r = await runGates({
      parallel: false,
      gates: {
        format: { mode: 'required', run: ok('format') },
        lint: { mode: 'required', run: fail('lint') },
        typecheck: { mode: 'required', run: ok('typecheck') },
      } as never,
      order: ['format', 'lint', 'typecheck'],
    });
    expect(calls).toEqual(['format', 'lint']);
    expect(r.passed).toBe(false);
    expect(r.firstFailure).toBe('lint');
  });

  it('continues when failed gate is mode=warn', async () => {
    const r = await runGates({
      parallel: false,
      gates: {
        format: {
          mode: 'warn',
          run: async () => ({ passed: false, exitCode: 1, output: '', durationMs: 1 }),
        },
        lint: {
          mode: 'required',
          run: async () => ({ passed: true, exitCode: 0, output: '', durationMs: 1 }),
        },
      } as never,
      order: ['format', 'lint'],
    });
    expect(r.passed).toBe(true);
  });
});

describe('runGates parallel', () => {
  it('runs read-only gates concurrently when parallel=true and commitMsg serially last', async () => {
    const calls: string[] = [];
    const mk =
      (name: string, ms: number, pass = true) =>
      async () => {
        calls.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, ms));
        calls.push(`end:${name}`);
        return { passed: pass, exitCode: pass ? 0 : 1, output: '', durationMs: ms };
      };
    const start = Date.now();
    const r = await runGates({
      parallel: true,
      order: ['format', 'lint', 'typecheck', 'test', 'coverage', 'security', 'commitMsg'],
      gates: {
        format: { mode: 'required', run: mk('format', 100) },
        lint: { mode: 'required', run: mk('lint', 100) },
        typecheck: { mode: 'required', run: mk('typecheck', 100) },
        test: { mode: 'required', run: mk('test', 100) },
        coverage: { mode: 'warn', run: mk('coverage', 100) },
        security: { mode: 'required', run: mk('security', 100) },
        commitMsg: { mode: 'required', run: mk('commitMsg', 50) },
      },
    });
    const elapsed = Date.now() - start;
    expect(r.passed).toBe(true);
    // 6 parallel × 100ms ≈ 100ms wall + 50ms commitMsg ≈ 150ms (with overhead, allow 400ms)
    expect(elapsed).toBeLessThan(400);
    // commitMsg should start AFTER all others end:
    const commitMsgStart = calls.indexOf('start:commitMsg');
    const lastReadOnlyEnd = Math.max(
      ...['format', 'lint', 'typecheck', 'test', 'coverage', 'security'].map((n) =>
        calls.indexOf(`end:${n}`),
      ),
    );
    expect(commitMsgStart).toBeGreaterThan(lastReadOnlyEnd);
  });

  it('parallel=false reproduces sequential fail-fast behavior', async () => {
    const calls: string[] = [];
    const r = await runGates({
      parallel: false,
      order: ['format', 'lint', 'typecheck'],
      gates: {
        format: {
          mode: 'required',
          run: async () => {
            calls.push('format');
            return { passed: false, exitCode: 1, output: '', durationMs: 10 };
          },
        },
        lint: {
          mode: 'required',
          run: async () => {
            calls.push('lint');
            return { passed: true, exitCode: 0, output: '', durationMs: 10 };
          },
        },
        typecheck: {
          mode: 'required',
          run: async () => {
            calls.push('typecheck');
            return { passed: true, exitCode: 0, output: '', durationMs: 10 };
          },
        },
      } as never,
    });
    expect(r.passed).toBe(false);
    expect(r.firstFailure).toBe('format');
    // sequential fail-fast: lint and typecheck should NOT run after format failed
    expect(calls).toEqual(['format']);
  });

  it('exposes gates_parallel_ms and gates_serial_sum_ms', async () => {
    const r = await runGates({
      parallel: true,
      order: ['format', 'lint', 'commitMsg'],
      gates: {
        format: {
          mode: 'required',
          run: async () => ({ passed: true, exitCode: 0, output: '', durationMs: 50 }),
        },
        lint: {
          mode: 'required',
          run: async () => ({ passed: true, exitCode: 0, output: '', durationMs: 60 }),
        },
        commitMsg: {
          mode: 'required',
          run: async () => ({ passed: true, exitCode: 0, output: '', durationMs: 20 }),
        },
      } as never,
    });
    expect(r.gates_serial_sum_ms).toBe(50 + 60 + 20);
    expect(r.gates_parallel_ms).toBeGreaterThanOrEqual(0);
    // wall time ≤ serial sum is only guaranteed with real delays; just assert field exists
    expect(typeof r.gates_parallel_ms).toBe('number');
  });
});
