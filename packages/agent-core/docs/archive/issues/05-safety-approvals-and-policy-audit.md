# Phase 5: Safety, Approvals, and Policy Audit

## Purpose

Introduce deterministic governance controls so high-impact actions are policy-checked, optionally human-approved, and fully auditable.

## Outcomes Required

- Policy evaluation stage before tool dispatch.
- Approval workflow for risk-classified actions.
- Audit store linking requests, steps, decisions, and outcomes.
- Tenant-scoped retrieval interfaces for compliance and incident review.

## Contribution Scope

- Support policy outcomes: allow, block, rewrite.
- Model approval lifecycle via workflow signals.
- Persist approver identity, timestamps, and decision correlation IDs.
- Expose query APIs to reconstruct decision chains.

## Definition Of Done

- Blocked actions never reach adapters.
- Approved actions run once with idempotency guarantees.
- Rejected approvals end in auditable terminal state.
- Full policy/approval chain is queryable per tenant/workspace.

## Why It Matters

Open source agent infrastructure must be safe-by-default, not safety-by-convention.
