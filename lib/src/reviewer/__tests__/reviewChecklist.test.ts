import { describe, expect, it } from 'vitest';
import { applyChecklist } from '../reviewChecklist.js';

describe('applyChecklist', () => {
  it('flags a diff that adds a hardcoded secret', () => {
    const r = applyChecklist({
      diff: '+ const apiKey = "sk-1234567890abcdef1234"',
      contextRules: ['no hardcoded secrets'],
    });
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0]?.severity).toBe('blocker');
    expect(r.decision).toBe('request_changes');
  });

  it('passes a clean diff', () => {
    const r = applyChecklist({
      diff: '+ const greet = (name: string) => `hello, ${name}`;',
      contextRules: [],
    });
    expect(r.findings).toEqual([]);
    expect(r.decision).toBe('approve');
  });
});
