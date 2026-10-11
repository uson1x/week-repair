# Design decisions

| Choice | Reason | Cost or limit |
| --- | --- | --- |
| Repair an existing week | A small task has clear before/after evidence and hard constraints. | No exercise generation or long-term planning. |
| Two separate model calls | Planning and review have different instructions and contexts. | The same model family can repeat the same error. |
| Deterministic acceptance gate | Session identity, capacity, and preservation rules should not depend on model judgment. | Code checks only rules represented in the input. |
| At most two repair rounds | Failed reviews get a chance to improve without an endless loop. | A solvable scenario may still end blocked. |
| Structured responses | Explicit fields make validation, feedback, and replay practical. | Schema compliance alone does not prove a good plan. |
| Clarification as an explicit result | Missing information should be visible to the user. | The CLI does not conduct a full interactive follow-up. |
| CLI and static HTML | A reviewer can inspect the artifact without a hosted app or account. | No shared state or calendar integration. |
| Fixtures beside a live provider | Tests and demos stay reproducible and work without credentials. | Fixtures must be clearly labeled and kept separate from live evidence. |
| Synthetic data only | The public artifact needs no private code, personal schedule, or service access. | It is not proof of integration with a real training product. |

The next useful investment is a small, versioned evaluation set with human judgments about intent and tradeoffs. Adding more agents would not by itself establish better reliability.
