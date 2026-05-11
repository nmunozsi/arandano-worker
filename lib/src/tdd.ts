export interface TddResult {
  ok: boolean;
  reason?: string;
}

export function detectRedGreen(subjectsOldestFirst: string[]): TddResult {
  let testIdx = -1;
  let implIdx = -1;
  for (let i = 0; i < subjectsOldestFirst.length; i += 1) {
    const s = subjectsOldestFirst[i] ?? '';
    if (testIdx === -1 && s.startsWith('test:')) testIdx = i;
    if (implIdx === -1 && (s.startsWith('feat:') || s.startsWith('fix:'))) implIdx = i;
  }
  if (testIdx === -1) return { ok: false, reason: 'no test: commit' };
  if (implIdx === -1) return { ok: false, reason: 'no feat:/fix: commit' };
  if (testIdx >= implIdx) return { ok: false, reason: 'test commit must precede impl commit' };
  return { ok: true };
}
