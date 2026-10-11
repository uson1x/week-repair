# Week Repair: build contract

A TypeScript CLI with a static HTML report. No database, application account, hosted workflow, or external product code. The Planner proposes a repair; a separate Reviewer checks intent and tradeoffs. Code checks control approval. Allow at most two repair rounds. Keep exercise prescriptions unchanged. Do not claim the tool assesses training safety.

Input `Scenario`: `id`, `title`, `request`, `asOf` (YYYY-MM-DD), `weekStart`, `weekEnd`, `availableMinutes` (date:number), `availableEquipment` (string[]), `maxWeeklyMinutes` (number), `minDaysBetweenHardSessions` (number, day distance), `maxSessionsPerDay` (number), `sessions` (Session[]).

Session: `id`, `title`, `date`, `durationMinutes`, `intensity` ('easy'|'hard'), `equipment` (string[]), `status` ('completed'|'missed'|'planned'), `locked` (boolean), `priority` ('required'|'optional'). Required means cannot drop. Completed/locked sessions must stay unchanged. Missed sessions can move to asOf or later, or drop if optional. Planned sessions cannot be scheduled before asOf. Every original session must have exactly one decision; no invented sessions or changed duration/intensity.

Proposal: `status` ('ready'|'needs_clarification'), `summary`, `decisions` (Decision[]), `questions` (string[]). Decision: `sessionId`, `action` ('keep'|'move'|'drop'), `date` (YYYY-MM-DD|null), `reason`. A ready plan has no questions. needs_clarification must have a specific question and must never be published as an approved plan.

Review: `approved` boolean, `issues` string[], `strengths` string[]. Reviewer sees original scenario, proposal and deterministic violations. Reject unmet user intent, vague questions, unnecessary dropping, or false claims. Independent context per call.

Validation: exported `validateScenario(input: unknown): Scenario` throws on malformed/contradictory input structure; exported `validateProposal(scenario: Scenario, proposal: unknown): string[]` returns exact violations. Check shapes; ID coverage/uniqueness; completed/locked preservation; required preservation; date range and past; action/date consistency; daily capacity/equipment for future sessions; max sessions/day; full-week total includes completed; hard-session day spacing including completed. Do not reject completed history for today's equipment or availability. needs_clarification can omit decisions; still shape-check it and questions. No ready output without all checks passing.

Pipeline: `runWorkflow(scenario, provider, options?)` returns a WorkflowResult. Provider interface `generate<T>(role: 'planner'|'reviewer', system: string, payload: unknown, schema: object): Promise<T>`. Save complete structured stage outputs, violations, duration, attempts, provider identity (no secrets). `WorkflowResult`: scenario, status ('approved'|'needs_clarification'|'blocked'), proposal (Proposal|null), review (Review|null), trace (TraceEvent[]), startedAt, elapsedMs, provider. TraceEvent: stage, attempt, durationMs, input (unknown optional), output (unknown optional), errors (string[] optional).

Output report accepts WorkflowResult and uses escaped text. Distinguish live model execution from replay/fixture evidence. Public examples contain synthetic data only. Keep private documents, employer code, credentials, and personal files out of the repository.

