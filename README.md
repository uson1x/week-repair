# Week Repair

**Repair a disrupted training week. Keep completed work and fixed constraints intact. Show why each change was made.**

Week Repair is a small TypeScript CLI with two model steps and a deterministic acceptance gate. A Planner proposes a new schedule. A Reviewer checks the proposal against the request. Code checks the hard rules before a plan can be approved.

The input is a synthetic training schedule. This is a standalone prototype, with no ATP integration or production user data. It moves or drops existing sessions; it does not write exercise prescriptions or assess medical suitability.

## Try the demo

Use Node.js 22 or later.

```sh
npm ci
npm test
npm run demo
```

The demo replays a saved result. It needs no model account or API key. Open `runs/replay/report.html` in a browser to inspect the proposed schedule, decisions, checks, and stage trace. Replay makes no new model calls; inspect the saved result's provider and trace for its original evidence.

To generate a fresh repair, use an installed, authenticated Claude CLI:

```sh
npm run live
```

The Planner and Reviewer run as separate Claude CLI processes with separate prompts and context. Model tools are disabled. An authenticated subscription CLI can run this path without separate API-key setup. See the [review guide](docs/REVIEW.md) for the evidence distinction.

To render any saved result again:

```sh
npm run replay -- examples/disrupted-week/result.json
```

## How a repair is accepted

```text
Scenario → validate input → Planner → deterministic checks → Reviewer
                              ↑                              │
                              └──── bounded repair feedback ─┘
                                                             │
                                     all checks pass + approval
                                                             ↓
                                                   JSON + HTML report
```

There are at most two repair rounds. A model cannot waive a failed check. Missing information produces a clarification request. Exhausted retries produce a blocked result. Neither result is an approved plan.

The checks preserve completed and locked sessions, keep required sessions, enforce dates and capacity, check equipment and daily session limits, count completed work in the weekly total, and enforce spacing between hard sessions. Every original session needs exactly one decision. A repair cannot invent a session or alter its duration or intensity.

## Review in a few minutes

1. Run the tests and the replay demo.
2. Open the HTML report and compare the original week with the proposed week.
3. Inspect the JSON trace for each model step, validation result, attempt, and duration.
4. Read [observed failures](docs/FAILURES.md) and [design decisions](docs/DECISIONS.md).

| Read | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Data flow, boundaries, and failure handling |
| [Review guide](docs/REVIEW.md) | What each kind of evidence proves |
| [Decisions](docs/DECISIONS.md) | Scope and tradeoffs |
| [Failures](docs/FAILURES.md) | Actual execution findings and fixes |

## Limits

Two independent calls do not imply independent model families or eliminate shared model errors. The Reviewer supplies judgment; code checks only the constraints represented in the input. The prototype has no calendar sync, persistence service, deployment, or user study. It does not validate training safety. Fixture tests show software behavior, not model reliability in production.
