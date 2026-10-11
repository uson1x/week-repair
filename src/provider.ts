import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { Provider } from './domain.js';

export class ProviderError extends Error {
  constructor(message: string, public readonly evidence?: unknown) { super(message); this.name = 'ProviderError'; }
}

export function parseClaudeOutput<T>(raw: string): T {
  let envelope: unknown;
  try { envelope = JSON.parse(raw); } catch { throw new ProviderError('Claude returned malformed JSON.', { raw }); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new ProviderError('Claude returned an invalid response envelope.', { output: envelope });
  const data = envelope as Record<string, unknown>;
  if (data.is_error === true) throw new ProviderError('Claude reported a model execution error.', { output: envelope });
  if (data.structured_output !== undefined) return data.structured_output as T;
  if (typeof data.result === 'string') {
    try { return JSON.parse(data.result) as T; } catch { throw new ProviderError('Claude result was not structured JSON.', { output: envelope }); }
  }
  if (data.result && typeof data.result === 'object') return data.result as T;
  throw new ProviderError('Claude response contained no structured output.', { output: envelope });
}

export class ClaudeProvider implements Provider {
  readonly identity: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly executable: string;
  private readonly model: string;
  constructor(options: { executable?: string; model?: string; timeoutMs?: number; maxOutputBytes?: number } = {}) {
    this.executable = options.executable ?? process.env.CLAUDE_BIN ?? 'claude';
    this.model = options.model ?? 'sonnet';
    this.timeoutMs = options.timeoutMs ?? 75_000;
    this.maxOutputBytes = options.maxOutputBytes ?? 1_048_576;
    this.identity = `live:claude-cli:${this.model}`;
  }
  async generate<T>(_role: 'planner' | 'reviewer', system: string, payload: unknown, schema: object): Promise<T> {
    const args = ['--safe-mode', '-p', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--system-prompt', system,
      '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--model', this.model];
    const input = JSON.stringify(payload);
    return new Promise<T>((resolve, reject) => {
      // Fresh process and neutral cwd prevent conversation/session or project-file context reuse.
      const child = spawn(this.executable, args, { cwd: tmpdir(), shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
      let stdout = '', stderr = '', bytes = 0, done = false;
      const finishError = (error: Error) => {
        if (done) return;
        done = true; clearTimeout(timer); child.kill('SIGKILL'); reject(error);
      };
      const timer = setTimeout(() => finishError(new ProviderError(`Claude timed out after ${this.timeoutMs} ms.`, { stdout, stderr })), this.timeoutMs);
      const receive = (channel: 'stdout' | 'stderr', chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > this.maxOutputBytes) { finishError(new ProviderError('Claude exceeded the output size limit.')); return; }
        if (channel === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
      };
      child.stdout.on('data', (chunk: Buffer) => receive('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => receive('stderr', chunk));
      child.on('error', (error) => finishError(new ProviderError(`Claude could not start: ${error.message}`)));
      child.stdin.on('error', (error) => finishError(new ProviderError(`Claude input failed: ${error.message}`)));
      child.on('close', (code, signal) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (code !== 0) { reject(new ProviderError(`Claude exited with ${code ?? signal}.`, { stdout, stderr })); return; }
        try { resolve(parseClaudeOutput<T>(stdout)); } catch (error) { reject(error); }
      });
      child.stdin.end(input);
    });
  }
}
