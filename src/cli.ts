#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Scenario, WorkflowResult } from './domain.js';
import { CodexProvider } from './provider.js';
import { runWorkflow, validateReview } from './workflow.js';
import { validateProposal, validateScenario } from './validate.js';
import { renderReport } from './report.js';

const usage = `Week Repair\n  npm run demo  (view a saved run)\n  npm run live  (run the agents)\n  npm run run -- --scenario fixtures/disrupted-week.json --out runs/disrupted-week --provider codex\n  npm run replay -- examples/disrupted-week/result.json [--out runs/replay]\n\nLive runs call a Planner and a separate Reviewer through Codex CLI.\nReplay creates a report from a saved result, without model calls.\nRequires Node 22+. For live runs, install Codex CLI and log in.\nSet CODEX_MODEL to choose a model or CODEX_BIN to choose the Codex executable.\n`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { process.stdout.write(usage); return; }
  const command = args[0] && !args[0].startsWith('--') ? args.shift()! : 'run';
  if (!['run', 'demo', 'replay'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const positional: string[] = [], flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!['--scenario', '--out', '--provider'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (flags.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    flags.set(arg, value);
  }
  const out = resolve(flags.get('--out') ?? (command === 'replay' ? 'runs/replay' : 'runs/disrupted-week'));
  await mkdir(out, { recursive: true });
  let result: WorkflowResult;
  if (command === 'replay') {
    if (positional.length !== 1) throw new Error('Replay requires exactly one saved result.json path.');
    const saved = JSON.parse(await readFile(resolve(positional[0]!), 'utf8')) as WorkflowResult;
    validateScenario(saved.scenario);
    if (!['approved', 'blocked', 'needs_clarification'].includes(saved.status) || !Array.isArray(saved.trace) || typeof saved.provider !== 'string') throw new Error('Malformed saved workflow result.');
    if (saved.status === 'approved' && (validateProposal(saved.scenario, saved.proposal).length || saved.proposal?.status !== 'ready' || saved.review?.approved !== true || validateReview(saved.review).length)) throw new Error('Saved approval fails verification; replay refused.');
    if (saved.status === 'needs_clarification' && (saved.proposal?.status !== 'needs_clarification' || validateProposal(saved.scenario, saved.proposal).length || saved.review?.approved !== true || validateReview(saved.review).length)) throw new Error('Saved clarification fails verification; replay refused.');
    result = { ...saved, provider: `replay:${saved.provider}` };
    process.stderr.write('Replay: creating a report from a saved run. No model calls.\n');
  } else {
    if (positional.length) throw new Error('Use --scenario for the input file.');
    const providerName = flags.get('--provider') ?? 'codex';
    if (providerName !== 'codex') throw new Error('Provider must be codex.');
    const scenarioPath = resolve(flags.get('--scenario') ?? 'fixtures/disrupted-week.json');
    const scenario = JSON.parse(await readFile(scenarioPath, 'utf8')) as Scenario;
    const provider = new CodexProvider();
    process.stderr.write(`Live run: ${provider.identity}; Planner, then Reviewer; at most two repair rounds.\n`);
    // Each completed stage is persisted before the next model call, including failures.
    result = await runWorkflow(scenario, provider, { onTrace: async (event, trace) => {
      process.stderr.write(`Attempt ${event.attempt}: ${event.stage} (${event.durationMs} ms)${event.errors?.length ? `; ${event.errors.length} issue(s)` : ''}\n`);
      await writeFile(resolve(out, 'trace.json'), JSON.stringify({ mode: 'live', scenario, provider: provider.identity, trace }, null, 2) + '\n');
    } });
  }
  await writeFile(resolve(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  await writeFile(resolve(out, 'report.html'), renderReport(result));
  process.stdout.write(`${result.status.toUpperCase()}\nEvidence: ${resolve(out, 'result.json')}\nReport: ${resolve(out, 'report.html')}\n`);
  if (result.status === 'blocked') process.exitCode = 1;
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Week Repair failed: ${message}\n`);
  process.exitCode = 1;
});
