import { spawn } from 'node:child_process';

export async function invokeCli(opts: {
  cli: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(opts.cli, opts.args, { cwd: opts.cwd, env: opts.env });
    let buf = '';
    proc.stdout.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stdin.end(opts.prompt);
    proc.on('close', (code) => resolve({ exitCode: code ?? 1, output: buf }));
  });
}
