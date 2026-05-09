import { describe, expect, it } from 'vitest';
import { WORKER_VERSION } from '../index.js';

describe('arandano-worker lib', () => {
  it('exports a version string', () => {
    expect(WORKER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
