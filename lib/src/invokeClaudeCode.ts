import { spawn } from 'node:child_process';

export interface InvokeCliOpts {
  cli: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  mcpConfigPath?: string;
}

export async function invokeCli(opts: InvokeCliOpts): Promise<{ exitCode: number; output: string }> {
  const finalArgs = opts.mcpConfigPath
    ? [...opts.args, '--mcp-config', opts.mcpConfigPath]
    : opts.args;
  return new Promise((resolve) => {
    const proc = spawn(opts.cli, finalArgs, { cwd: opts.cwd, env: opts.env });
    let buf = '';
    proc.stdout.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stdin.end(opts.prompt);
    proc.on('close', (code) => resolve({ exitCode: code ?? 1, output: buf }));
  });
}
