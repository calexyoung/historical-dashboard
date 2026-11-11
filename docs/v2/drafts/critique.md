# Critique of the two v2 plan drafts

Drafts reviewed: `plan-research-first.md` and `plan-reader-first.md`, both read against `docs/v2/BRIEF.md`. Written 2026-11-11. No code was changed.

## Part 1: Codex findings (verbatim, PARTIAL)

**Status: incomplete, not a full review.** Codex ran with both drafts and the brief in one prompt (read-only sandbox, review-only clause included). The orchestrator required this step's output before Codex wrote its final answer. What follows are Codex's interim conclusions, quoted verbatim from its run log. Its full section-by-section answer and its ranked top-10 list are **not included**. Treat this part as not fully reviewed. When the run finishes, its full output goes to `/private/tmp/claude-501/-Users-cayoung-Developer-annual-finance-usa/9f72b289-a55d-42fb-a1e1-f275e170e918/scratchpad/codex-out.md`. Fold it in before the merged PLAN.md goes to Gate 1.

> Two structural problems stand out: research-first promises indefinite reproducibility without fully preserving all inputs to an answer, while reader-first calls R2 “v2.0” before delivering much of the agreed scope. Both also treat withholding public output as sufficient protection for sources whose terms may restrict collection or storage itself.

> The source checks add two concrete blockers: FRED’s current API terms explicitly restrict archiving, and scheduled GitHub Actions workflows run only from the default branch—so research-first’s interim capture cannot simply live on `v2`. Reader-first also mounts the entire data store into the web container despite calling part of it private, and its v2 file paths would trigger the existing v1 refresh workflow after merges to `main`.

Both blockers below were raised by Codex and checked by Claude against the drafts:

- **Scheduled GitHub Actions run only from the default branch.** Research-first §3.10(a) and M5 put interim capture in a scheduled workflow, and all v2 work lives on a `v2` branch. A schedule defined on `v2` will not fire. The workflow has to live on `main`, which counts as a merge to `main` and so needs Alex, or it has to live in a separate private repo.
- **FRED API terms restrict archiving.** That undercuts any plan to keep FRED-channel data in the vintage store, not just plans to republish it. Withholding data from the public site does not settle the right to collect and store it.
- **Reader-first mounts the whole `DATA_DIR` into the web container,** including `obslog/`, `raw/` and `locks/`, which that draft itself calls ingest-private (§3.1, §3.10). Research-first's STORE/PUBLIC split fixes this.
- **Reader-first puts v2 paths on `main`.** v1's refresh workflow runs on `main`, so merges of v2 code there risk triggering it or colliding with it.
- **Research-first's "indefinite reproducibility" does not keep all the inputs an answer depends on.**
- **Reader-first labels R2 "v2.0"** before delivering much of the agreed scope (infrastructure, G20, claims).

Codex check: partial. It raised FRED archiving terms, the default-branch-only schedule, the reader-first data-mount leak, the v1 workflow on `main`, the incomplete reproducibility inputs, and R2 under-delivering scope. All are adopted in Part 3. The full Codex output has not been read yet.

---

## Part 2: Claude's assessment (Opus, independent of Codex)

I read both drafts in full, the brief, and the sibling project's `next.config.ts`. Points where I agree with Codex are cross-referenced in Part 3; this part is what I would say with or without it.

### 2.1 The real disagreement between the drafts

The drafts agree on most of the architecture. Both have one Python writer, an immutable Release directory as the seam, a read-only Next.js reader, a file obslog with no database, a rights gate with derived permissions and withheld-by-default, `/data/<key>` with file twins, two base-path builds, non-overlapping Caddy matchers, and claims private first. Where they differ:

| Question | Research-first | Reader-first | My pick |
|---|---|---|---|
| What ships first | One end-to-end fact-check (M1–M11) | Phone reader slice: cover + Inflation topic (M0–M5) | **A hybrid.** The research-first slice, with the reader-first *explained figure* (`lib/figure`) as the component that draws it |
| Where transform math lives | Only in TS `core`; Python never computes | TS `lib/query`, with Python still doing y/y and ratios at ingest, tied together by shared vectors | **Research-first.** One engine. The shared-vector approach is a standing drift tax |
| Vintage clock | Starts at M5, before the VPS | Starts when the obslog first runs in production (about M21) | **Research-first in intent, but cheaper** (see 2.3) |
| Branching | Long-lived `v2` branch; only cutover merges to `main` | v2 lives beside v1 on `main`; D11 makes every PR a merge to `main` | **Research-first.** Under the brief, every merge to `main` is a stop. Reader-first would stop about 50 times |
| Rights boundary | Two volumes (STORE writer-only, PUBLIC read-only) | One `DATA_DIR`; private dirs sit next to releases | **Research-first.** The web container physically cannot serve what it cannot mount |
| CSP | Enforced, `'self'` only, from the first deploy | Spike in M2; fall back to Report-Only with an ADR | **Reader-first.** See 2.2 |
| Reproducibility | Reconstruct and reproduce modes, `added_in`/`closed_in`, every `semantics_version` kept executable forever | Pins plus frozen rendered Edition artifacts | **Neither in full.** Locks that store materialised numbers are enough for v2.0 (2.4) |
| Annual report | Last (M34a/b) | Spine of R2 | **Middle.** A thin Living cover early; statements and segments after claims work |
| Claims | Phase A, the core | R3, after cutover | **Phase A.** The brief says the site is "primarily for Alex ... to check what politicians and pundits claim". Putting claims after a 21-PR public launch inverts the brief's stated priority |

### 2.2 Errors I found

**Research-first**
- §3.7: "CSP enforced (not Report-Only) from the first deploy, `'self'` only." This breaks Next.js App Router, which emits inline bootstrap and flight-data scripts. The sibling `/missions` itself uses `script-src 'self' 'unsafe-inline'` and only as Report-Only (`mission-dashboard/next.config.ts`). A nonce-based policy makes every page dynamic, which conflicts with the release-keyed caching in the same section. M8's AC ("zero CSP violations") would either fail or push the agent into a weakened workaround. Adopt reader-first's M2 spike.
- §3.4 retention says raw blobs are kept 90 days and then only if they revised a period. §0.2 says capture is "evidence lost for good" otherwise. Unchanged-fetch blobs are what prove "still this value on date X". The capture confirmations in the fetchlog keep the hash, but the bytes go, so a later parser fix cannot replay them. At about 0.6 GB a year, keep everything. This is a contradiction inside the draft.
- §3.1/§3.4: `current` is a symlink flipped by rename inside a volume that a different container mounts read-only. That works only if the symlink is relative and both containers mount the volume at the same path. Reader-first's `CURRENT` text file avoids the problem. Take that.
- §0.1 calls M1–M11 "eleven small PRs", but §7 sizes eight of them as M (two to three agent-days each). The slice is about 25 agent-days, not "small".
- M5's AC needs "seven consecutive daily runs". That is a wall-clock wait inside one PR, and the runner location is an [ALEX] item, so M5 cannot be autonomous as written. M35 has the same problem ("three consecutive daily releases").
- The §11 footnote says the last four Codex fixes "were not sent back for a fourth review". The most intricate part of the draft (`closed_in`, semantics versioning) is therefore unreviewed.

**Reader-first**
- §3.4 keeps y/y and ratio computation in Python *and* transforms in TS, then states "one transform runtime". It is two runtimes with an enumerated overlap. Claim evidence on a derived y/y series would rest on Python output while the chart's `pc1` rests on TS. That is exactly where a fact-check can disagree with its own chart.
- §3.9: refresh at 06:15 UTC means an 08:30 ET CPI or jobs release is not on the site until roughly 22 hours later. For a site whose job is to check what politicians say *that day*, this is the wrong default. Research-first's 14:30 UTC run (plus an optional late run) is better.
- §2.5: a 90 KB gzipped total JS budget "framework included" on Next 16 + React 19 is close to or below the framework floor (React DOM plus the Next client runtime alone is usually in the 90–110 KB range). The draft knows this and adds an [ALEX] stop to reset the cap. That is a stop the brief does not list. Set the budget from the M2 measurement as an ADR the agent writes, not an Alex decision.
- §1 vs §7: R1 "ends at M5" with "Living cover ... on rights-cleared data". But rights are audited only in M8 and native ingest arrives in M6. R1 can only run on the golden fixture or on v1's Yahoo/FRED-channel data, which this draft itself says must be withheld. As written, the R1 public staging preview has no real data it is allowed to show.
- M8: "Read and record terms for every owner and channel; set `status`." An agent should not make the legal determination. It should propose, and Alex confirms (research-first M12a gets this right).
- D11 ("merges to `main` for every milestone PR") together with code on `main` means a stop at every PR. That contradicts the autonomy model in the brief.

### 2.3 What I would add (missing from both)

1. **Start a raw-capture job now, separate from the store.** The cheapest way to stop losing vintage days is a tiny cron that fetches the rights-clean direct-agency endpoints and writes `raw/{source}/{date}/{sha}.gz` plus a fetchlog line. No obslog, no release, no Node. Later, M3's VintageStore *replays* those blobs. This decouples "start the clock" from "finish the store", and the M5 seven-day wait disappears from the critical path. Raw bytes are also legally the cleanest thing to hold privately. Hosting still needs Alex: a private GitHub repo with Actions is a remote, so the build agent cannot set it up alone.
2. **The brief's G20 "main index" item is probably not achievable on a public site with free sources.** S&P, FTSE Russell, Nikkei, STOXX and most national exchanges license index levels. FRED shows SP500 under licence, which does not pass through to downstream redistribution. Yahoo forbids it. Both drafts withhold by default, which is right. But neither says the plain thing: this brief item should be amended. One option is to show it only on the localhost profile. Another is to link out, or to replace it with a public-domain proxy such as a central-bank-published index where one exists. That is a brief change, so it goes to Alex at Gate 1, not to M29.
3. **A source-terms register as a milestone-zero artifact.** One table, `docs/v2/rights-register.md`, with a column per source: terms URL, date read, licence (PD / CC BY 4.0 / custom), attribution string, bulk-redistribution OK?, API-key terms (caching/storage limits), and unresolved questions. FRED/ALFRED (API terms restrict storing and caching, and third-party series are copyrighted), Philadelphia Fed RTDS (terms unclear), IMF (its copyright and usage terms are not CC BY; check bulk re-dissemination), OECD (CC BY 4.0 since 2024), World Bank (CC BY 4.0, with some datasets excluded), BIS (reuse with attribution, check bulk), Eurostat (CC BY 4.0), e-Stat (government-of-Japan terms, attribution), NOAA billion-dollar (retired, PD), OWID (CC BY), EM-DAT (non-commercial, no redistribution: link-only is correct), Yahoo (no). Both drafts scatter these across milestones. A register lets Alex sign D1 once.
4. **Defamation and fairness protocol for claims.** Both drafts have the mechanics (verbatim quote, archive URL, selection note, party filter, report-an-error). Neither has: (a) a rule that a public claim needs two independent archived sources for the quote, (b) a corrections SLA and visible correction log per claim, (c) a no-label rule for private individuals and pundits who are not public officials or candidates, and (d) a balance metric (claims per party per quarter) shown on the index. These are cheap, and they matter more than ClaimReview JSON-LD. One more point: emitting `ClaimReview` causes Google to surface the page as a fact-check, which raises the stakes on every label. Defer it until Alex opts in.
5. **Who writes competing explanations, and how citations are verified.** Reader-first M4/M16 and research-first M33 have Fable draft "competing explanations" from cited sources. That is the highest hallucination-risk content in the programme. Add an AC: every citation resolves, the cited passage is quoted in the content file's front matter (short, fair-use length), and Codex checks quote-to-claim fidelity. Drafts stay hidden (both already do this).
6. **An explicit autonomy budget.** Each milestone should list which of the four brief stop conditions it can hit and when. For example, M17/M11 hit credentials, M35/M5/M21 hit deploy, and any backup target hits money. That way the orchestrator can schedule Alex's inputs ahead of time instead of discovering stops mid-milestone. Both drafts have [ALEX] tags but no lead-time view.
7. **VPS resource check.** Both assume the shared Hostinger VPS can run another always-on Next container, a Python+Node ingest with pandas/pyarrow, and staging twice. No draft measures RAM and disk headroom next to `/missions`. Make it a step in the deploy-kit milestone (read-only `free -m`, `df -h` once SSH exists).

### 2.4 What I would cut or defer from v2.0

**From research-first:**
- Executable old `semantics_version`s forever.
- Reproduce mode for arbitrary `pin=` links, with `closed_in`.
- Pins answered from the current release by carrying all vintage rows forever.

Claim locks already store the exact numbers, so the evidence is permanent without any of this. For v2.0, keep locks (exact) plus `pin=` links that resolve against retained releases, and return 410 otherwise, which reader-first already designs. Revisit if Alex finds himself relying on pinned Explorer links. The research-first approach is intellectually right but is a large invariant to carry through 40 autonomous PRs.

Also from research-first:
- Private research profile (§3.11).
- MCP (M22) before the Explorer.
- `ClaimReview` JSON-LD.
- Window sensitivity strip (M27) until about ten claims exist.

**From reader-first:**
- The no-JS requirement for *everything*, including search and glossary popovers. Keep no-JS for reading pages and tables. Do not make it a universal gate.
- VoiceOver manual passes as milestone ACs. Use axe in CI, plus one manual pass at each release boundary.
- The three statements, six segment chapters, risk factors and the frozen 2025 Edition with rendered-artifact freezing: about 12 PRs. Ship a thin Living cover and Highlights first. The statements and segments are where Bagby's format lives, so they are a later phase, not v2.0's launch gate.
- Unusual-move spike (M31a/b).
- Share images.
- The 90 KB cap as a hard gate.

**From both:** about 40–50 PRs is too many for "v2.0". I would define **v2.0** as roughly 18–22 PRs:
- the research-first slice M1–M11, compressed to about 9 with the store and publisher merged where small;
- catalog migration and v1 adapters;
- primary-agency re-sourcing for the headline series;
- series pages, a thin Living cover with Highlights, and two topics (Inflation, Jobs);
- the Explorer at v1 parity;
- file twins, the read API and bulk export;
- the deploy kit;
- cutover.

Call everything else v2.1+. Infrastructure and G20 breadth are in the brief's scope, but they can arrive after cutover without breaking anything, because v1 already covers part of them.

### 2.5 Feasibility of autonomous milestones (my view)

- **Feasible as written:** pure-code milestones against fixtures (research-first M1, M3, M4, M6, M7, M9, M10, M19–M21, M23a/b, M25; reader-first M0, M2b, M3, M7, M9, M12, M17–M20).
- **Need network capture before the PR can be test-first:** every adapter milestone. The agent needs live network to capture fixtures once. That is allowed (it is not a remote write), but Yahoo via `curl_cffi` and FRED from a shared IP were flaky in research 02. Budget a retry day.
- **Will hit a stop earlier than the draft says:**
  - Research-first M5: runner location, a remote repo, a wall-clock week.
  - M17 and reader-first M11: keys. The AC "with keys `atlas check --network` passes" cannot be run by the agent.
  - Reader-first M5: SSH, Caddy, D1.
  - Reader-first M4: VoiceOver, plus Alex approval to *show* the slice.
  - M18 and reader-first M1: Philly Fed terms are legal judgement; the spike can report, but go/no-go on terms is Alex's.
  - Any backup-target milestone: possibly money.
- **Under-specified:**
  - Topic and explanation milestones (who verifies sources).
  - The rights audit (agent proposes vs decides).
  - Reader-first M15 ("chapter prose is limited to template sentences": which templates?).
  - Research-first M33 (seven topics in one M-sized PR is not credible; split it).
- **Too big for one PR:**
  - Research-first M33, M34b, M28 (19 countries × 4 indicators), M31.
  - Reader-first M6 (all adapters + rights + obslog in one), M7 (writer + images + timers + backups), M14 and M15 (already split, but each part is still large).

### 2.6 Recommended merged shape (one paragraph)

Take the research-first data architecture: STORE/PUBLIC split, single TS `core` engine with Node materialising derived series into the release, adapter contract with completeness flags, three claim evidence rows (`then`, `now_when_checked`, `latest`), and a long-lived `v2` branch. Simplify its reproducibility to locks plus retention-bounded pins. Take from reader-first:
- `CURRENT` as a text file;
- `STATUS.json` for failed runs, so an immutable release never has to record its own failure;
- the `withheld` manifest list shown by name;
- the CSP and JS-floor spikes in the shell milestone;
- the explained-figure component with templated takeaways and silence rules, built in the slice so the claim page is readable on a phone from day one;
- the "Research ▾" two-layer IA, applied once the Report exists;
- the content-only `--reuse-data` release.

Start a raw-only capture job as soon as Alex names a host. Put claims in Phase A, a thin annual-report cover and two topics before cutover, and statements, segments, Editions, infrastructure and G20 breadth after cutover.

---

## Part 3: Combined recommendations for the merged PLAN.md

1. **Use research-first's data architecture.**
   - STORE and PUBLIC volumes, with the web container mounting only PUBLIC (this fixes the leak Codex found in reader-first).
   - One TypeScript `core` engine.
   - The adapter contract with completeness flags.
   - The `then`, `now_when_checked` and `latest` evidence rows.
   - The long-lived `v2` branch.
2. **Take these from reader-first:**
   - `CURRENT` as a text file rather than a symlink.
   - `STATUS.json`, so a failed run can be reported without writing into an immutable release.
   - A `withheld` list shown by name, not a silent gap.
   - CSP and JavaScript-floor spikes in the shell milestone. The /missions site itself uses `'unsafe-inline'` with a Report-Only CSP, so research-first's "enforced `'self'` CSP from day one" will break Next.js.
   - The explained-figure component, built inside the claim slice.
3. **Claims go in Phase A,** matching the brief's primary purpose. Add a thin annual-report cover and two topics before cutover. Statements, segments, Editions, infrastructure and G20 breadth come after cutover. Say plainly what "v2.0" contains (about 20 PRs), so nothing is called v2.0 that does not deliver it (Codex's point).
4. **Simplify reproducibility to locks plus pins limited to retained releases.** Defer reproduce mode, `closed_in` and executable old semantics versions.
5. **Fix the interim capture design.**
   - Use a raw-bytes-only capture job that the store replays later.
   - Host it in a separate private repo, or on `main` with Alex's approval, because schedules do not fire from `v2`.
   - Limit it to public-domain direct-agency endpoints. Exclude FRED-channel and Yahoo data, which their terms do not allow storing.
   - Keep all raw blobs, not 90 days' worth.
6. **Before Gate 1, Alex decides on a rights register and the brief amendments it implies:**
   - G20 main stock indices are probably not publishable from free sources.
   - The FRED/ALFRED storage and archiving limits.
   - Philadelphia Fed RTDS terms.
   - IMF bulk re-dissemination.
7. **Add a claims fairness protocol:**
   - two archived sources for every quote;
   - a correction log on each claim page;
   - no labels on private individuals;
   - claim balance by party shown on the index;
   - ClaimReview markup only when Alex opts in.
8. **Give each milestone an explicit stop-condition and lead-time table,** so Alex's keys, host, SSH and approvals are requested ahead of time.
   - Remove wall-clock ACs from PRs (research-first's "7 consecutive days" in M5 and "3 consecutive releases" in M35).
   - Split milestones that are too big for one PR (research-first M28, M33, M34b; reader-first M6, M7).
9. **Refresh at about 14:30 UTC, not 06:15 UTC,** so 08:30 ET releases appear the same day.
