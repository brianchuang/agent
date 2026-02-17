# Agent Runtime Roadmap

This is the active roadmap for open source contributors.

## Current Status

- Foundational phase work (contracts, planner loop, persistence, safety, observability) is complete.
- Historical phase-by-phase specs are archived in `docs/archive/issues/`.

## Next Milestones

1. Provider Integrations
- Ship production-ready adapters for at least one messaging provider and one calendar provider.
- Add end-to-end tests that exercise real adapter behavior behind the same runtime contracts.

2. Policy Packs and Governance UX
- Publish reusable policy-pack templates with versioned defaults.
- Add dashboard workflows for reviewing and resolving pending approvals.

3. Replay Tooling for Operators
- Add CLI tooling to fetch replay traces by tenant/workflow and render drift reports.
- Add troubleshooting playbooks for common replay and resume failures.

4. Production Hardening
- Add load profiles that mirror real tenant traffic patterns.
- Define and publish SLO targets for latency, success rate, and resume reliability.

5. Contributor Experience
- Add a contributor quickstart for runtime + dashboard + database in under 10 minutes.
- Add architecture decision records (ADRs) for major contract or persistence changes.

## Contribution Priority

- Prioritize changes that preserve: tenant isolation, deterministic behavior, and replay safety.
- Avoid introducing domain-specific branching into runtime core.
