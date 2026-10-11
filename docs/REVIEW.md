# Review guide

Start with `npm ci`, `npm test`, and `npm run demo`. The demo needs no model credentials. Read the HTML report for the outcome and the JSON for each stage.

## Evidence levels

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Unit and workflow tests | The tested rules and workflow paths pass for the supplied inputs. | General model reliability or training safety. |
| Fixture tests | The workflow runs offline with controlled responses. | That a model generated those responses in this run. |
| Saved live trace | The recorded provider calls produced the captured outputs for that scenario. | That every future run will succeed. |
| Demo and HTML replay | A saved result can be inspected without a model call. | A new model execution or fresh approval. |

Live traces record the provider, start time, attempts, outputs, rule violations, and final state. [FAILURES.md](FAILURES.md) explains observed failures and fixes.

## Checks worth inspecting

- Completed and locked sessions remain unchanged.
- A required missed session is moved or the result asks for clarification; it is not silently dropped.
- Completed history counts toward weekly minutes and hard-session spacing.
- A model approval cannot override a failed rule.
- A rejected attempt supplies feedback to the next repair round.
- A clarification or blocked result is visibly different from an approved repair.
- User-controlled text appears as text in the HTML report.

## Suggested extension

Before connecting a calendar or training product, test representative cases with user consent. Have people judge the results and define how users accept changes. Production use also needs retention rules, access controls, provider failure monitoring, and versioned schemas.
