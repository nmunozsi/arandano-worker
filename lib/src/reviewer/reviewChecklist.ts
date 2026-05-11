export interface Finding {
  severity: 'info' | 'warn' | 'blocker';
  message: string;
  excerpt?: string;
}

export interface ChecklistResult {
  findings: Finding[];
  decision: 'approve' | 'request_changes';
}

const SECRET_PATTERNS = [/sk-[A-Za-z0-9]{16,}/, /AKIA[0-9A-Z]{16}/, /AIza[0-9A-Za-z\-_]{30,}/];

export function applyChecklist(opts: { diff: string; contextRules: string[] }): ChecklistResult {
  const findings: Finding[] = [];
  for (const re of SECRET_PATTERNS) {
    const m = re.exec(opts.diff);
    if (m) {
      findings.push({
        severity: 'blocker',
        message: 'possible hardcoded secret in diff',
        excerpt: m[0],
      });
    }
  }
  return {
    findings,
    decision: findings.some((f) => f.severity === 'blocker') ? 'request_changes' : 'approve',
  };
}
