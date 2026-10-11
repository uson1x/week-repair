# Design decisions

| Choice | Reason | Cost or limit |
| --- | --- | --- |
| Repair an existing week | An existing schedule provides a baseline and clear rules. | No exercise generation or long-term planning. |
| Two separate model calls | Planning and review have different instructions and contexts. | The same model family can repeat the same error. |
| Codex CLI provider | Reuses an existing Codex login and runs each role in a fresh process. | Live use needs a compatible, authenticated CLI and model access. |
| Code checks before approval | Session identity, capacity, and preservation rules should not depend on model judgment. | Code checks only rules represented in the input. |
| At most two repair rounds | A rejected proposal gets two chances to improve. | A solvable scenario may still end blocked. |
| JSON responses | Defined fields support validation, feedback, and replay. | Schema compliance alone does not prove a good plan. |
| A separate clarification state | The user can see which answer is needed. | The CLI does not conduct a full interactive follow-up. |
| CLI and static HTML | A reviewer can inspect the artifact without a hosted app or account. | No shared state or calendar integration. |
| Controlled test responses and saved replay | Tests and report review work without credentials. | Test doubles and replay must be clearly labeled and kept separate from fresh live execution. |
| Synthetic data only | The public artifact needs no private code, personal schedule, or service access. | It is not proof of integration with a real training product. |

Next, build a versioned evaluation set and have people judge whether the repairs meet their intent.
