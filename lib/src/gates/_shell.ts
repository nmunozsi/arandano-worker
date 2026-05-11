import { spawn } from 'node:child_process';

export interface ShellResult {
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
}

export async function runShell(opts: {
  cmd: string;
  args: string[];
  cwd: string;
}): Promise<ShellResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    const proc = spawn(opts.cmd, opts.args, { cwd: opts.cwd });
    let buf = '';
    proc.stdout.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.on('close', (code) => {
      resolve({
        passed: code === 0,
        exitCode: code ?? 1,
        output: buf,
        durationMs: Date.now() - started,
      });
    });
  });
}
