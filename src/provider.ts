import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Provider } from './domain.js';

export class ProviderError extends Error {
  constructor(message: string, public readonly evidence?: unknown) { super(message); this.name = 'ProviderError'; }
}

export function parseCodexOutput<T>(raw: string): T {
  try { return JSON.parse(raw) as T; }
  catch { throw new ProviderError('Codex final message was malformed JSON.', { raw }); }
}

/** Fresh ephemeral CLI process per role, using the user's existing Codex login. */
export class CodexProvider implements Provider {
  readonly identity: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly executable: string;
  private readonly model: string;
  constructor(options: { executable?: string; model?: string; timeoutMs?: number; maxOutputBytes?: number } = {}) {
    this.executable = options.executable ?? process.env.CODEX_BIN ?? 'codex';
    this.model = options.model ?? process.env.CODEX_MODEL ?? 'gpt-6.1-sol';
    this.timeoutMs = options.timeoutMs ?? 75_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
    this.identity = `live:codex-cli:${this.model}`;
  }
  async generate<T>(role: 'planner' | 'reviewer', system: string, payload: unknown, schema: object): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'week-repair-'));
    const schemaPath = join(dir, 'schema.json'), outputPath = join(dir, 'output.json');
    try {
      await writeFile(schemaPath, JSON.stringify(schema));
      const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
        '--model', this.model, '--config', 'model_reasoning_effort="low"', '--config', 'approval_policy="never"',
        '--config', 'web_search="disabled"', '--output-schema', schemaPath, '--output-last-message', outputPath, '--json',
        '--disable', 'shell_tool', '--disable', 'unified_exec', '--disable', 'apps', '--disable', 'plugins',
        '--disable', 'hooks', '--disable', 'browser_use', '--disable', 'computer_use', '--disable', 'memories',
        '--disable', 'multi_agent', '--disable', 'image_generation', '-'];
      const input = `${system}\n\nRole: ${role}. Do not use tools or read files. Produce only the JSON answer.\nInput data:\n${JSON.stringify(payload)}`;
      await this.execute(args, input, dir);
      const outputStat = await stat(outputPath).catch(() => { throw new ProviderError('Codex produced no final structured message.'); });
      if (outputStat.size > this.maxOutputBytes) throw new ProviderError('Codex final message exceeded the output size limit.');
      return parseCodexOutput<T>(await readFile(outputPath, 'utf8'));
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  private async execute(args: string[], input: string, cwd: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.executable, args, { cwd, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let stdout = '', stderr = '', bytes = 0, done = false;
      const finishError = (error: Error) => {
        if (done) return;
        done = true; clearTimeout(timer);
        // The npm Codex launcher starts a native child; stop that process too.
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch { child.kill('SIGKILL'); }
        reject(error);
      };
      const timer = setTimeout(() => finishError(new ProviderError(`Codex timed out after ${this.timeoutMs} ms.`, { stdout, stderr })), this.timeoutMs);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      const receive = (channel: 'stdout' | 'stderr', chunk: string) => {
        bytes += Buffer.byteLength(chunk, 'utf8');
        if (bytes > this.maxOutputBytes) { finishError(new ProviderError('Codex exceeded the output size limit.')); return; }
        if (channel === 'stdout') stdout += chunk; else stderr += chunk;
      };
      child.stdout.on('data', (chunk: string) => receive('stdout', chunk));
      child.stderr.on('data', (chunk: string) => receive('stderr', chunk));
      child.on('error', (error) => finishError(new ProviderError(`Codex could not start: ${error.message}`)));
      child.stdin.on('error', (error) => finishError(new ProviderError(`Codex input failed: ${error.message}`)));
      child.on('close', (code, signal) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (code !== 0) { reject(new ProviderError(`Codex exited with ${code ?? signal}.`, { stdout, stderr })); return; }
        resolve();
      });
      child.stdin.end(input);
    });
  }
}
