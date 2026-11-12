---
status: accepted (M11, 2026-11-11); computes no agency data yet (D2 is open, no row is signed)
---

# The engine step: Recipes in the series table, one Node step in staging, Derived series under the gate

ADR 0003 says one engine computes everything, and that Python never computes a Derived value.
ADR 0002 says the release job has a Node step that writes only inside staging. M11 builds both:
aggregation by Measure kind, the rest of the Transform allowlist, Recipes, and
`atlas-core verify`. This records the choices PLAN 4.2 to 4.5 left open. The contract for the
arithmetic is `docs/method/transforms.md`; for the step, `docs/method/release-writer.md`.

## Decisions

1. **Recipes are declared in the series table until the Catalog of M12.** An optional `derived`
   list beside the stored Series: key, frequency, name, unit, Recipe, `catalog` block. Python
   checks structure only (shape, inputs exist, no cycle, naming the cycle) and decides what may
   be computed. The first is `cpi_yoy`.
2. **`cpi_yoy` is the twelve-month change of the unadjusted index (`cpi_nsa`).** That is the
   figure BLS publishes as the headline, and the one the acceptance figure (9.1 for June 2022)
   is. v1's `cpi_yoy` was computed from the adjusted index through FRED and reads about a
   tenth lower in that month. The key keeps its name and its definition changes; the entry
   says "not seasonally adjusted". Alex may prefer the adjusted input or two keys (see
   "Open with Alex").
3. **The Node step runs the engine's TypeScript as it is.** `packages/core/bin/atlas-core.mjs`
   needs Node 22.18 or later and nothing else: Node strips the types, and one resolve hook
   finds the engine's extensionless imports. No bundle is committed and no `node_modules` is
   needed, so the ingest image fetches nothing from npm and CI's Python job can run the step.
4. **The step works in a directory of its own inside `.staging/`, before the release id
   exists.** A release id is a hash of the Release's files, Derived ones included, so the
   Derived files must exist before the final staging directory can be named. Python writes the
   Catalog, the stored Series and the list of keys to compute into `.staging/engine-…`, the
   step writes `derived/{key}.json` and `engine-report.json` there, Python reads them back as
   bytes and removes the directory. From then on they are files like any other: the same
   checks, the same contract validation, the same staging and promotion.
5. **The step is not trusted to stay inside its directory; it is checked.** It creates every
   file new (an existing file or a link in its place is refused) and refuses a `derived/` that
   is a link. Python then requires that everything in the directory is a plain file that was
   handed in unchanged, a Derived file for a key it asked for, or the report; that each
   Derived file is the bytes the report hashed; and that each key is either written or
   reported empty. Anything else rejects the run with `CURRENT` unchanged. A test also
   snapshots a whole tree around the staging directory and finds only those files new.
6. **The engine is asked for an explicit list, never "every recipe in the Catalog".** A local
   Release also holds v1's Derived series, which stay v1's values (ADR 0016).
7. **A Derived series is published only when every stored Series it rests on is published
   from the store in the same Release, and (public Profile) the gate permits display of the
   whole lineage.** Otherwise it is withheld by name with the reason. No Derived series is
   computed from a withheld input and then hidden. The gate and `rights_problems` are
   unchanged: they already walked a Recipe's inputs to the end.
8. **The Catalog entry of a Derived series names one Origin, as a label.** The release
   contract's entry has room for one. It is the Origin of the first stored Series the Recipe
   reaches, with the Channel `computed`. The lineage is the Recipe's inputs, and every reader
   that asks the gate walks them. The Rights block carries the most restrictive status of the
   stored Series it rests on and **all** their owners and attributions, so that no obligation
   to credit is dropped. The step checks the status against the engine's own answer. M12's
   series schema can give a Derived series a proper lineage block.
9. **The Basis and the Rights of a Derived answer are computed, not stored.** `derived/` holds
   the Release's own state. An as-of answer runs the Recipe over each input's own Vintage and
   claims the weakest Basis among them; if any input is unavailable there is no answer.
   Periods an input held under other metadata at the Cutoff are left out.
10. **Aggregation needs more than half of a Period's members for a mean or a last value, and
    all of them for a sum.** A partial Period keeps its value and is marked `partial`; nothing
    is compared with it. These are judgments about what would mislead, written in
    `transforms.md` so that they can be changed in one place.
11. **Daily and weekly Series are brought to months for `pc1`, `ch1` and `pca`,** and stay at
    their own frequency for `chg` and `pch`.
12. **`semantics_version` is 0.6.0.** Two behaviours M2 defined changed (C1 and C2 in
    `transforms.md`). The Explorer still offers v1's six Transforms; the four new ones are
    answered by Query and reach the Explorer with M18.
13. **Spot values are a JSON file,** `checks/spot.json`, not YAML as PLAN 4.4 names it: the
    step has no YAML parser and takes nothing from npm.
14. **The ingest image has its own build-context allowlist**
    (`deploy/ingest.Dockerfile.dockerignore`), so the web image's context does not grow. It
    holds the `atlas` package without v1's hand-entered tables, the schema, the spot values
    and the engine's source. No compose service and no timer: those are M26's and Alex's.

## Considered options

- **Compute Derived series in Python.** Rejected by ADR 0003: two engines.
- **Bundle the engine to JavaScript and commit the bundle, or `npm ci` in the ingest image.**
  A generated file to keep in step, or a second dependency tree in the writer's image.
- **Run the step in the final staging directory.** It cannot be named until the Derived files
  exist. Naming it first and renaming it after would make the id something other than a hash
  of what was promoted.
- **Withhold nothing, compute everything, filter at export.** Values the gate refuses would
  then exist in staging. ADR 0006 withholds by leaving out.
- **A register row for "Macro Atlas, computed".** A Derived entry could then name Macro Atlas
  as its Origin, but that row would need Alex's signature to publish anything computed, and a
  signature on it would say nothing about the inputs, which are what matter.

## Consequences

- A release run with a Recipe to compute needs Node. Without it the run is rejected and
  `CURRENT` stays. A run with none does not need Node.
- A Recipe that gives no value is withheld by name. On a local build that leaves no Series
  under that key even where v1 had one.
- When the engine's behaviour changes, a `--reuse-data` release keeps the old Derived files
  and the old `semantics_version`; a full run recomputes them.

## Open with Alex

- **What `cpi_yoy` means** (decision 2): the unadjusted index, as built, or the adjusted one
  v1 used. M12 writes the other y/y Recipes and can follow either.
- **The acceptance figure on agency data.** No register row is signed, so no BLS value is
  committed. The committed test reads v1's adjusted index (8.98 for June 2022, within 0.15 of
  9.1). On the unadjusted index the engine gives 9.06, checked once on 2026-11-11 against the
  keyless BLS API with nothing stored. `checks/spot.json` holds every release that has that
  month to 9.1 within 0.05. A committed fixture of real values waits for D2.
