import type { Proposal, Provider, Review, Scenario, TraceEvent, WorkflowResult } from './domain.js';
import { validateProposal, validateScenario } from './validate.js';
import { PLANNER_SYSTEM, REVIEWER_SYSTEM, proposalSchema, reviewSchema } from './prompts.js';
import { ProviderError } from './provider.js';

export interface WorkflowOptions {
  maxRepairRounds?: number;
  onTrace?: (event: TraceEvent, trace: readonly TraceEvent[]) => void | Promise<void>;
}

function proposalHasShape(value: unknown): value is Proposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return ['ready', 'needs_clarification'].includes(String(data.status)) && typeof data.summary === 'string' &&
    Array.isArray(data.questions) && data.questions.every((question) => typeof question === 'string') &&
    Array.isArray(data.decisions) && data.decisions.every((decision) => {
      if (!decision || typeof decision !== 'object' || Array.isArray(decision)) return false;
      const d = decision as Record<string, unknown>;
      return typeof d.sessionId === 'string' && ['keep', 'move', 'drop'].includes(String(d.action)) &&
        (typeof d.date === 'string' || d.date === null) && typeof d.reason === 'string';
    });
}

function reviewErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Reviewer output must be an object.'];
  const data = value as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof data.approved !== 'boolean') errors.push('Reviewer approved must be a boolean.');
  for (const field of ['issues', 'strengths']) {
    if (!Array.isArray(data[field]) || !(data[field] as unknown[]).every((item) => typeof item === 'string' && item.trim().length > 0)) errors.push(`Reviewer ${field} must be an array of nonempty strings.`);
  }
  if (data.approved === true && Array.isArray(data.issues) && data.issues.length > 0) errors.push('Reviewer cannot approve while reporting unresolved issues.');
  if (data.approved === false && Array.isArray(data.issues) && data.issues.length === 0) errors.push('Reviewer rejection must state a concrete issue.');
  return errors;
}

export async function runWorkflow(scenario: Scenario, provider: Provider, options: WorkflowOptions = {}): Promise<WorkflowResult> {
  const start = Date.now();
  const result: WorkflowResult = { scenario, status: 'blocked', proposal: null, review: null, trace: [], startedAt: new Date(start).toISOString(), elapsedMs: 0, provider: provider.identity ?? 'unidentified-provider' };
  let stage = 'scenario', attempt = 0, stageStart = start, stageInput: unknown = scenario;
  const add = async (event: TraceEvent) => { result.trace.push(event); await options.onTrace?.(event, result.trace); };
  try {
    validateScenario(scenario);
    const requested = options.maxRepairRounds ?? 2;
    if (!Number.isInteger(requested) || requested < 0 || requested > 2) throw new Error('maxRepairRounds must be an integer from 0 to 2.');
    let feedback: unknown = undefined;
    for (attempt = 1; attempt <= requested + 1; attempt++) {
      stage = 'planner'; stageStart = Date.now(); result.proposal = null; result.review = null;
      stageInput = { scenario, ...(feedback === undefined ? {} : { repairFeedback: feedback }) };
      const rawProposal = await provider.generate<unknown>('planner', PLANNER_SYSTEM, stageInput, proposalSchema);
      await add({ stage, attempt, durationMs: Date.now() - stageStart, input: stageInput, output: rawProposal });
      // A model's schema guarantee is never trusted at the application boundary.
      stage = 'validator'; stageStart = Date.now(); stageInput = rawProposal;
      const violations = validateProposal(scenario, rawProposal);
      await add({ stage, attempt, durationMs: Date.now() - stageStart, input: rawProposal, output: { violations }, errors: violations });
      result.proposal = proposalHasShape(rawProposal) ? rawProposal : null;
      stage = 'reviewer'; stageStart = Date.now(); stageInput = { scenario, proposal: rawProposal, deterministicViolations: violations };
      const rawReview = await provider.generate<unknown>('reviewer', REVIEWER_SYSTEM, stageInput, reviewSchema);
      const malformed = reviewErrors(rawReview);
      await add({ stage, attempt, durationMs: Date.now() - stageStart, input: stageInput, output: rawReview, errors: malformed });
      if (malformed.length) return finish();
      result.review = rawReview as Review;
      if (violations.length === 0 && result.review.approved && result.proposal) {
        if (result.proposal.status === 'ready') result.status = 'approved';
        else if (result.proposal.status === 'needs_clarification') result.status = 'needs_clarification';
        return finish();
      }
      feedback = { previousProposal: rawProposal, deterministicViolations: violations, reviewerIssues: result.review.issues };
    }
    await add({ stage: 'blocked', attempt: requested + 1, durationMs: 0, errors: ['Repair budget exhausted without deterministic and reviewer approval.'] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await add({ stage, attempt, durationMs: Date.now() - stageStart, input: stageInput, ...(error instanceof ProviderError && error.evidence !== undefined ? { output: error.evidence } : {}), errors: [message] }).catch(() => {});
  }
  return finish();
  function finish(): WorkflowResult { result.elapsedMs = Date.now() - start; return result; }
}
