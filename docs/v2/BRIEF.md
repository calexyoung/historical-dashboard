# Macro Atlas v2 — planning brief (agreed with Alex, 2026-11-11)

Settled in a grilling session. Planners may propose beyond this brief: Alex does not want
the design over-constrained by decisions made before anyone knew what was possible.

## Purpose
Understand the past and current state of the United States in a global context: economy,
politics, disasters, pandemics, infrastructure. For anyone, but primarily for Alex to research
and study, especially to check what politicians and pundits claim against facts (not spin) and to
see complex interactions rather than overly simple cause-and-effect.

Inspiration: Meredith E. Bagby, *The First Annual Report of the United States of America*
(Alex owns the original softcover): the nation presented like a corporate annual report.

## Scope
- The US in depth, including infrastructure as measurable series: construction spending
  (public/private), grid and energy production, freight and transport (rail, trucking, ports),
  water and broadband investment, federal infrastructure spending (IIJA, CHIPS).
- G20 headline indicators per economy (GDP, inflation, unemployment, policy rate, FX, main index),
  plus global trade and commodities.
- Free public sources only; every number traceable to its source (provenance is a feature).

## Product
- Dynamic server app: Next.js in Docker behind the existing Caddy on Alex's Hostinger VPS,
  the same stack as the mission dashboard at mydashboards.co/missions
  (~/Developer/mission-dashboard). Path: mydashboards.co/macro-atlas. No password.
- Server-side data refresh daily, no database at first. Shareable URLs, search, topic pages.
- Visual family resemblance with /missions; Emil Kowalski design skills guide the UI.

## Data in
- Files in the repo (series catalog, notes, claims in Markdown/YAML) plus an `atlas add` CLI.
- An in-browser editor behind a login is a later option, not v2.0.

## Data out
- Built for LLM and ML use: bulk downloads (CSV/Parquet/JSON), a read API with provenance,
  possibly an MCP connector. No runtime AI calls on the site in the first version.

## Team and process
- Opus orchestrates. Fable and Codex design and plan. mattpocock skills for planning/building
  (domain-modeling → CONTEXT.md + ADRs, codebase-design, tdd).
- Gate 1: the plan (docs/v2/PLAN.md) needs Alex's OK.
- Then Fable 5.2 builds autonomously in milestones, one PR each, Codex review per milestone.
  It stops and asks only for: production deploys, merges to main, anything that costs money,
  anything needing Alex's credentials.

## Constraints and open items
- VPS deploy user/SSH key: later. Until then build and test locally; staging target
  mydashboards.co/macro-atlas-staging. v1 stays live on GitHub Pages until v2 is approved.
- v1 lives in this repo (atlas/ Python pipeline, web/ front end, 126 series, 83 cited events,
  weekly GitHub Actions refresh). docs/v2/SPEC-v1.md is the original v1 spec.
