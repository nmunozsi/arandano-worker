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

    const cliStart = Date.now();
    let lineBuf = '';
    proc.stdout.on('data', (c: Buffer) => {
      const text = c.toString('utf8');
      buf += text;
      if (!fileStream) return;
      lineBuf += text;
      let idx = lineBuf.indexOf('\n');
      while (idx !== -1) {
        const line = lineBuf.slice(0, idx);
        lineBuf = lineBuf.slice(idx + 1);
        if (line.trim()) {
          try {
            const e = JSON.parse(line) as unknown;
            fileStream.write(JSON.stringify({ ts: Date.now() - cliStart, e }) + '\n');
          } catch {
            fileStream.write(JSON.stringify({ ts: Date.now() - cliStart, raw: line }) + '\n');
          }
        }
        idx = lineBuf.indexOf('\n');
      }
    });
    proc.stderr.on('data', (c: Buffer) => (buf += c.toString('utf8')));
    proc.stdin.end(opts.prompt);

    proc.on('error', (e) => resolve({ exitCode: 1, output: String(e) }));
    proc.on('close', (code) => {
      if (fileStream && lineBuf.trim()) {
        try {
          const e = JSON.parse(lineBuf) as unknown;
          fileStream.write(JSON.stringify({ ts: Date.now() - cliStart, e }) + '\n');
        } catch {
          fileStream.write(JSON.stringify({ ts: Date.now() - cliStart, raw: lineBuf }) + '\n');
        }
      }
      if (fileStream) {
        fileStream.end(() => resolve({ exitCode: code ?? 1, output: buf }));
      } else {
        resolve({ exitCode: code ?? 1, output: buf });
      }
    });
  });
}
