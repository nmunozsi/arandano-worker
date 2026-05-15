'use strict';

// Curated 16-emoji mapping. Each shortcode → exactly one Conventional Commits type.
const MAPPING = Object.freeze({
  ':sparkles:': 'feat',
  ':bug:': 'fix',
  ':ambulance:': 'fix',
  ':lock:': 'fix',
  ':zap:': 'perf',
  ':recycle:': 'refactor',
  ':fire:': 'refactor',
  ':white_check_mark:': 'test',
  ':memo:': 'docs',
  ':art:': 'style',
  ':rotating_light:': 'style',
  ':wrench:': 'chore',
  ':construction_worker:': 'ci',
  ':arrow_up:': 'chore',
  ':arrow_down:': 'chore',
  ':bookmark:': 'chore',
});

const LEADING_RE = /^(:[a-z0-9_+\-]+:)\s+([a-z]+)(?:\(([^)]+)\))?:\s+\S/;

function gitmojiLeading(parsed) {
  const subject = (parsed.header || '').trim();
  const m = LEADING_RE.exec(subject);
  if (!m) {
    return [
      false,
      'commit subject must match `:emoji: type(scope): subject`. See docs/commits-and-architecture/spec.md §4 for the curated emoji list.',
    ];
  }
  const emoji = m[1];
  if (!Object.prototype.hasOwnProperty.call(MAPPING, emoji)) {
    return [
      false,
      `emoji ${emoji} is not in the curated set. Allowed: ${Object.keys(MAPPING).join(', ')}.`,
    ];
  }
  return [true];
}

function gitmojiTypeMatch(parsed) {
  const subject = (parsed.header || '').trim();
  const m = LEADING_RE.exec(subject);
  if (!m) return [true]; // leave the failure to gitmoji-leading
  const emoji = m[1];
  const type = m[2];
  const expected = MAPPING[emoji];
  if (!expected) return [true]; // again, gitmoji-leading owns this
  if (expected !== type) {
    return [false, `emoji ${emoji} must pair with type \`${expected}\`, got \`${type}\`.`];
  }
  return [true];
}

module.exports = {
  MAPPING,
  rules: {
    'gitmoji-leading': gitmojiLeading,
    'gitmoji-type-match': gitmojiTypeMatch,
  },
};
