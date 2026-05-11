import { describe, expect, it } from 'vitest';
import { runGates } from '../runGates.js';

describe('runGates', () => {
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
