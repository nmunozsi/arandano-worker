import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout.trim();
}

export async function currentBranch(cwd: string): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  try {
    await git(['checkout', '-b', name], cwd);
  } catch {
    // branch already exists from a prior failed run — force-recreate from current HEAD
    await git(['branch', '-D', name], cwd);
    await git(['checkout', '-b', name], cwd);
  }
}

export async function commitSubjects(cwd: string, base: string): Promise<string[]> {
  const out = await git(['log', `${base}..HEAD`, '--pretty=%s'], cwd);
  return out.length ? out.split('\n') : [];
}
