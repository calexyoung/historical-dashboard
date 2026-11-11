---
status: proposed (awaiting Gate 1)
---

# v2 is built on a long-lived `v2` branch; `main` stays v1 until cutover

The brief makes every merge to `main` a stop for Alex, and `main` runs v1's weekly refresh to GitHub
Pages on any push that touches `atlas/**`. So every milestone PR targets a `v2` branch, CI runs on
those pull requests, and `main` is not touched until the single cutover PR, which also retires
`refresh.yml`. v1 fixes, if any, go to `main` and are merged forward.

## Considered options

- **Build v2 beside v1 on `main`.** Every one of about 26 PRs would stop for Alex, and v2 paths
  would trigger or collide with v1's refresh workflow.

## Consequences

- Scheduled GitHub workflows fire only from the default branch, so nothing scheduled can live on
  `v2`. The interim capture job (ADR 0012) therefore runs somewhere else.
- The cutover merge is large. It is rehearsed on staging first.
