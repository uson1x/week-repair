# Architecture

Week Repair separates language-based judgment from rules that code can check.

## Input and output

A scenario contains the current date, week bounds, time and equipment limits, and existing sessions. Each session has a stable ID, date, duration, intensity, required equipment, status, lock, and priority.

The Planner returns a structured proposal. Each decision keeps, moves, or drops an existing session and gives a reason. A proposal can instead ask for clarification. The Reviewer returns an approval flag, issues, and strengths.

The workflow returns one of three states:

| State | Meaning |
| --- | --- |
| `approved` | A ready proposal passed the deterministic checks and the Reviewer approved it. |
| `needs_clarification` | The proposal asks a specific question. It is not approved. |
| `blocked` | The workflow could not obtain an acceptable plan within its limits. |

## Boundaries

| Module | Responsibility |
| --- | --- |
| `domain.ts` | Shared data types |
| `validate.ts` | Input validation and schedule rules |
| `prompts.ts` | Planner and Reviewer instructions and response schemas |
| `provider.ts` | Structured generation through a live or fixture provider |
| `workflow.ts` | Stage order, feedback, attempt limit, and result state |
| `cli.ts` | Read a scenario, select a provider, and save results |
| `report.ts` | Render an escaped, static HTML report |

The provider interface is `generate(role, system, payload, schema)`. This boundary lets tests supply controlled responses without calling a model. The live implementation calls Claude CLI separately for each role. The Reviewer receives the original scenario, the proposal, and the rule violations. It does not inherit the Planner's conversation.

## Acceptance rules

Input validation rejects malformed or contradictory scenario data. Proposal validation checks shape, complete and unique ID coverage, action/date consistency, and schedule constraints. Completed and locked sessions stay unchanged. Required sessions cannot be dropped. Future sessions must fit the date range, time, equipment, and daily count limits. Completed history still counts toward the weekly total and hard-session spacing; today's equipment and availability do not invalidate completed history.

An invalid proposal cannot become approved because a Reviewer approves it. Reviewer rejection and rule failures feed the next attempt. The retry limit prevents an open-ended model conversation. A clarification request must include a specific question and cannot be displayed as an approved repair.

## Trace and report

Each stage records its attempt, duration, structured input and output where available, and errors. The result also records provider identity and total elapsed time. This makes a rejected proposal reviewable and supports replay without another model call. The report escapes input text before placing it in HTML.

The trace is evidence of this run, not a model-quality benchmark. Public examples use synthetic inputs only. Credentials must not be included in saved traces.
