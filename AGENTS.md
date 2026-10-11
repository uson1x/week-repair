# Working on Week Repair

Read `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` before changes.

- Keep model proposals separate from code checks.
- Only accept a plan when code checks and the independent reviewer pass.
- Stop after the configured repair limit. Record a blocked or clarification result.
- Keep completed sessions and locked sessions unchanged.
- Use synthetic data in fixtures and public reports. Never commit credentials.
- Keep exercise prescriptions unchanged. Do not claim the tool assesses training safety.
- Use short, concrete sentences.
- Run `npm run check` and `npm test` before a commit.
- Update `docs/FAILURES.md` only with observed evidence. Label injected faults and test doubles.
- Keep each commit focused. Keep agent prompts and contracts in version control.
