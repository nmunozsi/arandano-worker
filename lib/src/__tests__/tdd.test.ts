import { describe, expect, it } from 'vitest';
import { detectRedGreen } from '../tdd.js';

describe('detectRedGreen', () => {
  it('returns ok when test commit precedes feat/fix', () => {
    const r = detectRedGreen(['test: add failing case', 'feat: implement']);
    expect(r.ok).toBe(true);
  });
  it('fails when only feat commits exist', () => {
    expect(detectRedGreen(['feat: implement']).ok).toBe(false);
  });
  it('fails when feat precedes test', () => {
    expect(detectRedGreen(['feat: implement', 'test: add case']).ok).toBe(false);
  });
});
