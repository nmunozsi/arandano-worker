'use strict';
const local = require('./rules.cjs');

// Conventional Commits header pattern, prefixed by an OPTIONAL gitmoji shortcode.
// The shortcode is captured but ignored — gitmoji-leading / gitmoji-type-match
// validate the original header.text directly.
const HEADER_PATTERN = /^(?::[a-z0-9_+\-]+:\s+)?(\w+)(?:\(([^)]+)\))?: (.+)$/;

module.exports = {
  extends: ['@commitlint/config-conventional'],
  parserPreset: {
    parserOpts: {
      headerPattern: HEADER_PATTERN,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },
  plugins: [
    {
      rules: local.rules,
    },
  ],
  rules: {
    'gitmoji-leading': [2, 'always'],
    'gitmoji-type-match': [2, 'always'],
  },
  ignores: [(message) => /^Merge /i.test(message)],
};
