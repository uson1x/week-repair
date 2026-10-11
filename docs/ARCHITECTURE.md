# Architecture

Models assess intent and tradeoffs. Code checks schedule rules.

## Input and output

A scenario contains the current date, week bounds, time and equipment limits, and existing sessions. Each session has a stable ID, date, duration, intensity, required equipment, status, lock, and priority.

The Planner returns a structured proposal. Each decision keeps, moves, or drops an existing session and gives a reason. A proposal can instead ask for clarification. The Reviewer returns an approval flag, issues, and strengths.

The workflow returns one of three states:

| State | Meaning |
| --- | --- |
| `approved` | A ready proposal passed the code checks and review. |
| `needs_clarification` | The proposal asks a specific question. It is not approved. |
| `blocked` | The workflow stopped after an error or exhausted its repair rounds. |

The Reviewer's `approved` flag accepts a response, which may be a clarification question. The workflow approves a schedule only when a valid `ready` proposal passes all checks. An accepted question returns `needs_clarification`. An [observed live failure](FAILURES.md#1-the-reviewer-rejected-a-correct-clarification) exposed this distinction.

## Boundaries

| Module | Responsibility |
| --- | --- |
| `domain.ts` | Shared data types |
| `validate.ts` | Input validation and schedule rules |
| `prompts.ts` | Planner and Reviewer instructions and response schemas |
| `provider.ts` | Structured generation through Codex CLI |
| `workflow.ts` | Stage order, feedback, attempt limit, and result state |
| `cli.ts` | Read a scenario, select a provider, and save results |
| `report.ts` | Render an escaped, static HTML report |

The provider interface is `generate(role, system, payload, schema)`. Tests use this interface to supply controlled responses. Live runs start a separate, ephemeral `codex exec` process for each role using the existing Codex login. Each process runs in a new temporary directory with a read-only sandbox; user config, plugins, shell, browser, and app tools are disabled. Temporary schema and output files are removed after the call. The Reviewer receives the original scenario, the proposal, and the rule violations. It does not inherit the Planner's conversation.

## Acceptance rules

Input validation rejects malformed or contradictory scenario data. Proposal validation checks shape, complete and unique ID coverage, action/date consistency, and schedule constraints. Completed and locked sessions stay unchanged. Required sessions cannot be dropped. Future sessions must fit the date range, time, equipment, and daily count limits. Completed history still counts toward the weekly total and hard-session spacing; today's equipment and availability do not invalidate completed history.

Reviewer approval cannot override a failed code check. Reviewer rejection and rule failures feed the next attempt. The default limit is one initial attempt plus at most two repair rounds. A malformed Reviewer response or provider error stops with a blocked result. A clarification request must include a specific question and cannot be displayed as an approved repair.

## Trace and report

Each stage records its attempt, duration, structured input and output where available, and errors. The result also records provider identity and total elapsed time. These records support debugging and replay. The report escapes input text before placing it in HTML.

A trace records one run. Public examples use synthetic inputs. Keep credentials out of saved traces.
