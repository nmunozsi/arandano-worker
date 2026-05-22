import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface InvokeCliOpts {
  cli: string;
  args: string[];
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  mcpConfigPath?: string;
  /** When present AND args include --output-format stream-json, write all stdout to this path. */
  eventsPath?: string;
}

export async function invokeCli(opts: InvokeCliOpts): Promise<{ exitCode: number; output: string }> {
  const finalArgs = opts.mcpConfigPath
    ? [...opts.args, '--mcp-config', opts.mcpConfigPath]
    : opts.args;

  const wantsStreamJson =
    opts.eventsPath !== undefined && opts.args.includes('--output-format') &&
    opts.args.includes('stream-json');

  let fileStream: ReturnType<typeof createWriteStream> | undefined;
  if (wantsStreamJson && opts.eventsPath) {
    await mkdir(dirname(opts.eventsPath), { recursive: true });
    fileStream = createWriteStream(opts.eventsPath, { encoding: 'utf8' });
    fileStream.on('error', () => {});
  }

  return new Promise((resolve) => {
    const proc = spawn(opts.cli, finalArgs, { cwd: opts.cwd, env: opts.env });
    let buf = '';

    proc.stdout.on('data', (c: Buffer) => {
      const text = c.toString('utf8');
      buf += text;
      if (fileStream) fileStream.write(text);
    });
    proc.stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stdin.end(opts.prompt);

    proc.on('error', (e) => resolve({ exitCode: 1, output: String(e) }));
    proc.on('close', (code) => {
      if (fileStream) {
        fileStream.end(() => resolve({ exitCode: code ?? 1, output: buf }));
      } else {
        resolve({ exitCode: code ?? 1, output: buf });
      }
    });
  });
}
