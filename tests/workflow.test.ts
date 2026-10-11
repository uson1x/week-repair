import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReport } from '../src/report.js';
import type { Provider, Scenario, Proposal, Review } from '../src/domain.js';
import { runWorkflow } from '../src/workflow.js';
import { parseCodexOutput, ProviderError, CodexProvider } from '../src/provider.js';

// Explicitly synthetic scripted provider: these tests provide no live model evidence.
class ScriptedFake implements Provider {
  identity = 'test:scripted-fake';
  calls: { role: string; system: string; payload: unknown }[] = [];
  constructor(private script: unknown[]) {}
  async generate<T>(role: 'planner' | 'reviewer', system: string, payload: unknown): Promise<T> {
    this.calls.push({ role, system, payload });
    if (!this.script.length) throw new Error('Scripted fake exhausted.');
    const output = this.script.shift();
    if (output instanceof Error) throw output;
    return structuredClone(output) as T;
  }
}
const scenario: Scenario = {
  id: 'test', title: 'Synthetic week', request: 'Keep the required missed session and avoid Saturday.',
  asOf: '2026-10-07', weekStart: '2026-10-05', weekEnd: '2026-10-11',
  availableMinutes: { '2026-10-07': 60, '2026-10-08': 60, '2026-10-09': 60, '2026-10-10': 0, '2026-10-11': 60 },
  availableEquipment: ['mat'], maxWeeklyMinutes: 120, minDaysBetweenHardSessions: 2, maxSessionsPerDay: 1,
  sessions: [
    { id: 'done', title: 'Completed', date: '2026-10-05', durationMinutes: 30, intensity: 'hard', equipment: ['mat'], status: 'completed', locked: true, priority: 'required' },
    { id: 'missed', title: 'Missed', date: '2026-10-06', durationMinutes: 30, intensity: 'hard', equipment: ['mat'], status: 'missed', locked: false, priority: 'required' },
  ],
};
const ready: Proposal = { status: 'ready', summary: 'Move the missed session to Wednesday.', questions: [], decisions: [
  { sessionId: 'done', action: 'keep', date: '2026-10-05', reason: 'Keep completed history.' },
  { sessionId: 'missed', action: 'move', date: '2026-10-07', reason: 'Fits available time and spacing.' },
] };
const approve: Review = { approved: true, issues: [], strengths: ['Preserves the required sessions.'] };
const reject: Review = { approved: false, issues: ['Prefer Friday to preserve the requested rest day.'], strengths: [] };
const invalid: Proposal = { ...ready, decisions: [ready.decisions[0]!, { sessionId: 'missed', action: 'drop', date: null, reason: 'Skip it.' }] };

test('two independent role calls approve only after deterministic validation', async () => {
  const provider = new ScriptedFake([ready, approve]);
  const result = await runWorkflow(scenario, provider);
  assert.equal(result.status, 'approved');
  assert.deepEqual(provider.calls.map((call) => call.role), ['planner', 'reviewer']);
  assert.notEqual(provider.calls[0]!.system, provider.calls[1]!.system);
  assert.deepEqual((provider.calls[1]!.payload as { deterministicViolations: string[] }).deterministicViolations, []);
  assert.equal(result.provider, 'test:scripted-fake');
  assert.deepEqual(result.trace.map((event) => event.stage), ['planner', 'validator', 'reviewer']);
});

test('deterministic rejection causes a real control-flow retry with actionable feedback', async () => {
  const provider = new ScriptedFake([invalid, approve, ready, approve]);
  const result = await runWorkflow(scenario, provider);
  assert.equal(result.status, 'approved');
  assert.equal(provider.calls.length, 4);
  const feedback = (provider.calls[2]!.payload as { repairFeedback: { deterministicViolations: string[] } }).repairFeedback;
  assert.ok(feedback.deterministicViolations.length > 0);
  assert.equal(result.trace.at(-1)!.attempt, 2);
});

test('reviewer rejection also triggers a repair even when deterministic checks pass', async () => {
  const provider = new ScriptedFake([ready, reject, ready, approve]);
  const result = await runWorkflow(scenario, provider);
  assert.equal(result.status, 'approved');
  assert.deepEqual((provider.calls[2]!.payload as { repairFeedback: { reviewerIssues: string[] } }).repairFeedback.reviewerIssues, reject.issues);
});

test('exhausted loop makes at most three proposals and never approves rejected constraints', async () => {
  const provider = new ScriptedFake([invalid, approve, invalid, approve, invalid, approve]);
  const result = await runWorkflow(scenario, provider);
  assert.equal(result.status, 'blocked');
  assert.equal(provider.calls.length, 6);
  assert.equal(result.trace.filter((event) => event.stage === 'planner').length, 3);
  assert.match(result.trace.at(-1)!.errors![0]!, /budget exhausted/);
});

test('rejected review stays blocked when repair budget is zero', async () => {
  const provider = new ScriptedFake([ready, reject]);
  assert.equal((await runWorkflow(scenario, provider, { maxRepairRounds: 0 })).status, 'blocked');
});

test('malformed reviewer output is recorded and fails closed without truthy coercion', async () => {
  for (const output of [{ approved: 'true', issues: [], strengths: [] }, null, { approved: true, issues: ['Unresolved issue.'], strengths: [] }]) {
    const provider = new ScriptedFake([ready, output]);
    const result = await runWorkflow(scenario, provider);
    assert.equal(result.status, 'blocked');
    assert.equal(result.review, null);
    assert.ok(result.trace.at(-1)!.errors!.length > 0);
    assert.deepEqual(result.trace.at(-1)!.output, output);
  }
});

test('clarification remains clarification even with reviewer approval', async () => {
  const clarification = { status: 'needs_clarification', summary: 'Need your scheduling preference.', decisions: [], questions: ['Can the required missed session move to Friday?'] };
  const result = await runWorkflow(scenario, new ScriptedFake([clarification, approve]));
  assert.equal(result.status, 'needs_clarification');
});

test('provider timeout and other exceptions yield blocked results with preserved evidence', async () => {
  for (const error of [new ProviderError('Codex timed out after 75000 ms.', { stdout: 'partial' }), new Error('Provider unavailable.')]) {
    const result = await runWorkflow(scenario, new ScriptedFake([ready, error]));
    assert.equal(result.status, 'blocked');
    assert.equal(result.trace.length, 3);
    assert.equal(result.trace.at(-1)!.stage, 'reviewer');
    assert.match(result.trace.at(-1)!.errors![0]!, /timed out|unavailable/);
    if (error instanceof ProviderError) assert.deepEqual(result.trace.at(-1)!.output, { stdout: 'partial' });
  }
});

test('invalid scenario and invalid repair budget block before model execution', async () => {
  const provider = new ScriptedFake([]);
  assert.equal((await runWorkflow({ ...scenario, asOf: 'invalid' }, provider)).status, 'blocked');
  assert.equal((await runWorkflow(scenario, provider, { maxRepairRounds: 3 })).status, 'blocked');
  assert.equal(provider.calls.length, 0);
});

test('Codex final message parsing accepts JSON and rejects malformed text', () => {
  assert.deepEqual(parseCodexOutput(JSON.stringify(ready)), ready);
  assert.throws(() => parseCodexOutput('{oops'), /malformed JSON/);
});

test('malformed planner output remains in trace and blocked report still renders', async () => {
  for (const malformed of [null, { status: 'ready', summary: 'bad', decisions: 'bad', questions: [] }]) {
    const result = await runWorkflow(scenario, new ScriptedFake([malformed, approve]), { maxRepairRounds: 0 });
    assert.equal(result.status, 'blocked');
    assert.equal(result.proposal, null);
    assert.deepEqual(result.trace[0]!.output, malformed);
    assert.match(renderReport(result), /blocked/i);
  }
});

test('Codex subprocess timeout kills a hanging test executable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'week-repair-provider-test-'));
  const executable = join(dir, 'fake-codex');
  try {
    await writeFile(executable, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    const provider = new CodexProvider({ executable, timeoutMs: 40 });
    await assert.rejects(provider.generate('planner', 'test', {}, {}), /timed out after 40 ms/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('clarification may omit decisions without being promoted to ready', async () => {
  const clarification = { status: 'needs_clarification', summary: 'Need your preference.', questions: ['Can the missed session move to Friday?'] };
  const result = await runWorkflow(scenario, new ScriptedFake([clarification, approve]));
  assert.equal(result.status, 'needs_clarification');
  assert.deepEqual(result.proposal!.decisions, []);
  assert.deepEqual(result.trace[0]!.output, clarification);
});


test('Codex subprocess output limit rejects oversized test executable output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'week-repair-output-test-'));
  const executable = join(dir, 'fake-codex');
  try {
    await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write('x'.repeat(4096));\n`);
    await chmod(executable, 0o700);
    const provider = new CodexProvider({ executable, timeoutMs: 2000, maxOutputBytes: 256 });
    await assert.rejects(provider.generate('planner', 'test', {}, {}), /output size limit/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});




test('Codex test executable receives isolated schema, fresh cwd, stdin and disabled tools', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'week-repair-spawn-test-'));
  const executable = join(dir, 'fake-codex');
  try {
    await writeFile(executable, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nlet payload = '';\nprocess.stdin.on('data', chunk => payload += chunk);\nprocess.stdin.on('end', () => fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify({args, cwd: process.cwd(), payload})));\n`);
    await chmod(executable, 0o700);
    const provider = new CodexProvider({ executable, model: 'synthetic-test-model' });
    const output = await provider.generate<{ args: string[]; cwd: string; payload: string }>('planner', 'Synthetic planner system.', { marker: 'synthetic' }, {});
    assert.ok(output.args.includes('--ephemeral'));
    assert.ok(output.args.includes('--ignore-user-config'));
    assert.ok(output.args.includes('read-only'));
    assert.ok(output.args.includes('shell_tool'));
    assert.ok(output.args.includes('web_search="disabled"'));
    assert.ok(output.args.includes('--output-schema'));
    assert.match(output.payload, /Synthetic planner system/);
    assert.match(output.payload, /"marker":"synthetic"/);
    assert.notEqual(output.cwd, process.cwd());
    // Provider removes each isolated work directory after reading the result.
    await assert.rejects(import('node:fs/promises').then(fs => fs.stat(output.cwd)), /ENOENT/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('accepted clarification for an impossible required week stops after one review without publishing a schedule', async () => {
  const impossible = JSON.parse(await readFile(new URL('../fixtures/impossible-required.json', import.meta.url), 'utf8')) as Scenario;
  const clarification = {
    status: 'needs_clarification',
    summary: 'The two required 30-minute sessions need 60 minutes and two slots; Sunday has 30 minutes and one slot.',
    decisions: [],
    questions: ['Can you extend the scheduling window, or change the requirement to keep both sessions?'],
  };
  const provider = new ScriptedFake([clarification, { approved: true, issues: [], strengths: ['The specific question identifies the conflicting constraints.'] }]);
  const result = await runWorkflow(impossible, provider);
  assert.equal(result.status, 'needs_clarification');
  assert.equal(result.proposal!.status, 'needs_clarification');
  assert.equal(result.review!.approved, true);
  assert.equal(provider.calls.length, 2);
  assert.deepEqual(result.trace.map(event => event.attempt), [1, 1, 1]);
});
