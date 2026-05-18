import { describe, expect, it } from 'vitest';

// architectDriver is heavy on side effects (git, child_process, network). A pure
// unit test isolates the no-op detection only.
describe('architectDriver no-op detection', () => {
  it('matches "architect: no-op" regardless of case and surrounding text', () => {
    const re = /architect:\s*no-op/i;
    expect(re.test('done, architect: no-op, exiting')).toBe(true);
    expect(re.test('ARCHITECT:    NO-OP')).toBe(true);
    expect(re.test('architect ok')).toBe(false);
  });
});
