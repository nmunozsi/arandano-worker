'use strict';
const local = require('./rules.cjs');

module.exports = {
  extends: ['@commitlint/config-conventional'],
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
