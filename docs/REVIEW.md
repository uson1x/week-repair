# Review guide

Start with `npm ci`, `npm test`, and `npm run demo`. The demo is designed to be reviewed without model credentials. Inspect both the report and its saved JSON data: the report explains the outcome, while the JSON preserves the stage evidence.

## Evidence levels

| Evidence | What it proves | What it does not prove |
| --- | --- | --- |
| Unit and workflow tests | Named rules and control paths behave as asserted for supplied inputs. | General model reliability or training safety. |
| Fixture tests | The pipeline can be exercised offline with controlled responses. | That a model generated those responses in this run. |
| Saved live trace | The recorded provider calls produced the captured outputs for that scenario. | That every future run will succeed. |
| Demo and HTML replay | A saved result can be inspected without a model call. | A new model execution or fresh approval. |

Live evidence should identify the provider, start time, stage attempts, outputs, rule violations, and final state. A failed live run is useful evidence when its trace shows where and why it stopped. Current execution findings belong in [FAILURES.md](FAILURES.md).

## Checks worth inspecting

- Completed and locked sessions remain unchanged.
- A required missed session is moved or the result asks for clarification; it is not silently dropped.
- Completed history counts toward weekly minutes and hard-session spacing.
- A model approval cannot override a failed rule.
- A rejected attempt feeds a bounded repair loop.
- A clarification or blocked result is visibly different from an approved repair.
- User-controlled text appears as text in the HTML report.

## Suggested extension

Before connecting a real calendar or training product, add representative consented cases, evaluate intent satisfaction with human reviewers, and define how a user accepts changes. A production system also needs retention rules, access controls, provider failure monitoring, and versioned schemas. These are outside this prototype.
