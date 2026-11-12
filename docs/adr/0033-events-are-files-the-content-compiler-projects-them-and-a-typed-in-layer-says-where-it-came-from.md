---
status: accepted (M19, 2026-11-12); 35 of v1's 83 Events are drafts awaiting Alex's wording (docs/v2/events-review.md); no hand-entered layer is committed (no register row is signed)
---

# Events are files, the content compiler projects them, and a typed-in layer says where it came from

M19 makes Macro Atlas's own content a thing with files and a compiler: v1's 83 Events become
`content/events/*.md`; a content compiler writes a Release's `content/` for both Profiles;
Annotations are projected from the Events and from hand-entered layers; Events get pages;
`atlas add event|note` writes drafts; the Explorer's layers read compiled content. The
acceptance: a round trip of all 83 Events and every v1 field; each citation archived or a
listed exception; every migrated text checked against a word list and by Codex, the failures
listed for Alex with a proposed wording and not silently changed; `atlas add` writes drafts
that pass `atlas check`; the Explorer's annotation tests from M4 pass unchanged. This records
the choices the plan left open. The contract for a person who writes content is
`docs/method/content.md`.

## Decisions

1. **An Event is `content/events/{id}.md`**: front matter held to `schema/event.schema.json`
   (unknown fields refused; no field for a finding, a rating or an effect), then the
   description as text. The id is the date as written, then a slug, and is permanent: it is
   the file's name, the page's address and, with `event-` before it, the Annotation's id. The
   ids are the ones the legacy converter gave v1's Events before M19
   (`checks/v1-event-ids.json`), so every `event=` link and v1's `hi=` order still resolve.
2. **A date is as precise as the record: a day, a month or a year, and no day is made up.**
   `date` is `YYYY-MM-DD`, `YYYY-MM` or `YYYY` and `date_precision` says which. An Event that
   spans time has an `end` in the same precision, inclusive. An Event still running has no
   place yet (`end` cannot be null): it is recorded when it has ended. On a time axis a day is
   a date anchor, a month or a year is a Period anchor, and a span is whole days, first to last.
3. **Three categories are added to v1's five**: `disaster`, `infrastructure`, `legislation`.
   v1's `health` keeps v1's label ("Health & disaster") so v1's layers read as they did.
4. **The migration is lossless and adds three things, none of them to v1's words.** An id; an
   archived copy of the cited address or the reason there is none; a status.
   `scripts/migrate_events.py` is the record: its output turned back into v1's shape is
   `atlas/events.yaml` exactly (83 Events, every field, in order). v1 has titles only, so no
   description was migrated and none was written: 83 descriptions from memory would be 83
   uncited texts. `atlas/events.yaml` stays: v1 on `main` builds from it until cutover.
5. **Archived copies were looked up, never made.** The Internet Archive's availability lookup
   was asked once (2026-11-12) for the copy nearest 2026-09-22, the day v1 says its citations
   were checked: 75 of 80 addresses have one (`scripts/event-archives.json`). The five without
   carry `no_archive` with that reason in their own file: the listed exceptions. Asking the
   archive to save a page changes a third party's record, so it is left to Alex. A citation
   has `archive_url` or `no_archive`; the schema takes neither both nor none.
6. **The word list is closed, literal and blunt, and a person decides.**
   `atlas/content/wordlist.py` holds causal terms and evaluative terms, matched as whole words
   in any case with no exemption for a proper name. It finds places to look; it does not judge.
   A `public` Event whose title or description has a listed word fails `atlas check` and stops
   a public-profile release. The ways through are another wording, or `accepted_terms` on that
   Event for a word that belongs to the thing's own name. `atlas add` cannot write
   `accepted_terms` and cannot write `status: public`: both are a person's edit.
7. **Every migrated title was read twice, and what either reading listed is a draft.** The
   word list hit 26 titles. Codex, given all 83 and asked which are causal, evaluative or not a
   plain statement, listed 34, among them titles that join two happenings as if one explained
   the other ("China devalues yuan; global selloff"). The union is 35. Each is written with
   `status: draft` and its words unchanged, and is listed with a proposed wording in
   `content/events/migration-review.json` and `docs/v2/events-review.md`. The other 48 are
   `public`. A draft is in every local-profile Release and in no public-profile one, so the
   local Explorer still shows v1's 83 and a public Release shows 48. This is a choice, not the
   plan's wording: "listed for Alex, not silently changed" would also allow all 83 to stay
   public. Drafting is the conservative reading of the neutrality rule, and undoing it is one
   word per file. The review file is a record of that one day and is not edited afterwards.
8. **The content compiler is the one writer of a Release's `content/`.**
   `atlas.content.compile.compile_content(profile, content, manual, gate, legacy_annotations)`
   reads files and returns `content/events.json` and `content/annotations.json`. Every writer
   calls it: the legacy converter, `atlas release` (fresh, `--reuse-data` and the Release a
   withdrawal promotes) and nothing else; the fixture is written by hand beside it. A
   public-profile compile leaves drafts out of every file, refuses v1's layers, and asks the
   gate about each hand-entered layer. A local-profile compile holds drafts, each saying it is
   one. Content that cannot be compiled refuses the release (during a withdrawal that means
   the root is left with no `CURRENT`, as for any other failure there).
9. **Release contract 0.3.0.** `content/events.json` is required from 0.3.0 and unknown before
   it; 0.1.0 and 0.2.0 Releases still open and have no Events. Both validators hold every
   Event to exactly one Annotation that says what it says (id, title, category, anchor, first
   citation; `event_projection`), refuse a date that is not as precise as it claims
   (`bad_event_date`) and a repeated id (`duplicate_event_id`), and refuse a draft Event in a
   public-profile Release (`draft_in_public`). An Annotation's `series` still means "belongs
   to": an Event's `related_series` is not projected into it.
10. **`related_series` is checked where it is written, and named where it is read.** `atlas
    check` requires each key to be in the Catalog. A Release carries the list whole even when
    it does not hold the Series (not captured yet, withheld): the Event's page links the ones
    the Release shows, gives the reason for the withheld ones and says "Not in this release"
    for the rest. Dropping the reference would hide a fact of the record.
11. **A term of government or a recession is typed in from somebody's record, so its Annotation
    says where from.** Terms files (ADR 0030) become `governance` spans. Recessions get a file
    kind of their own, `catalog/manual/spans/{name}.json` (`layer: recession`; dated spans, in
    order, each with a citation), under the same rule as every hand-entered file: none is
    committed until its Origin's row is signed for `store` and `redistribute`. Each projected
    Annotation carries `provenance {producer, dataset, via, representation}`, and the rights
    check of a Release (`rights_problems`: at release, reuse, rollback, pin and `atlas doctor`)
    asks the gate about it for as long as the Release is kept. In a 0.3.0 public-profile
    Release a `governance`, `recession` or `policy` Annotation with no provenance is a rights
    problem. Un-signing a row therefore fails the Releases that hold its layer, as it does for
    a Series.
12. **v1's bands and recessions stay on a local Release, marked as v1's, until a hand-entered
    file replaces the set.** This is the one place the converter's projection survives, and it
    is the exception to "the Explorer's layers now read compiled content": no register row is
    signed, so no terms or recession file can be committed, and without v1's the local Explorer
    would lose the bands M4's tests hold to v1's dates. The converter hands them to the
    compiler with `representation: legacy_monthly_rounded`; a set (one office, or the
    recessions) is hand-entered whole or v1's whole; both validators refuse one in a
    public-profile Release (`legacy_in_public`) and the site's reader refuses it on a public
    Surface. v1's Events are not taken from the converter at all.
13. **`atlas check` has a fifth layer, `content`.** Every file under `content/events` is an
    Event or the review record; its related Series exist; a public Event's text is clear of the
    list. A draft with a listed word is a NOTE, not an error, so `atlas add event` followed by
    `atlas check` passes. Every file under `notes/` is one user's note in that user's folder.
14. **A User note is written and checked, and compiled into nothing.** `atlas add note --user
    U --about claim:ID|series:KEY|topic:SLUG` writes `notes/{user}/{date}-{slug}.md` with
    `status: draft`. The compiler has no door for `notes/`, so a note is in no Release of
    either Profile; reading them on the local Surface is M21's, and a public one waits for
    Alex (D7(d), M44). A Series target must be in the Catalog; Claims and Topics are not files
    yet, so theirs is held to its shape only.
15. **Event pages are reading pages.** `/events` (newest first, by year; the category is a
    link, so the address says what is listed) and `/events/{id}` (title, when, category, the
    description if one is written, each citation with its archived copy or the reason there is
    none, the Series to set beside it). Server-rendered, no script, no motion. The "Open in
    Explorer" link is offered only when the Event names a Series this Release can draw on this
    Surface: it opens those Series two years either side with the Event's layer on and the
    Event marked. The Explorer lists an Event that spans time whenever any part of it is in the
    window, and reads a Period anchor of four digits as a year.

## Considered and not done

- **Write descriptions for the 83.** Uncited prose from memory; the plan limits an Event's text
  to cited statements. Left empty, and the page says so.
- **Keep all 83 public.** See 7.
- **Reword the listed titles.** The plan forbids changing them silently; proposals only.
- **A separate file of archive exceptions.** An exception keyed by Event would excuse a citation
  added later; in the citation itself it excuses exactly one address.
- **Project `related_series` into the Annotation's `series`.** That field means "belongs to",
  and a later reader of it would hide an Event from every other Series.
- **Draw a span Event as a band.** Bands are the governance layer's; one set at a time. A span
  Event is a tick at its start and says its span in words.
- **Compile notes into a local Release.** No reader yet; a contract change with nothing to use it.

## Consequences

- When Alex decides a wording he edits the Event's file (title, `status: public`, or
  `accepted_terms`). v1's title then no longer comes back from that file, and the tests that
  hold the legacy Release to v1's titles (M2's and M4's) will name that Event: that is the
  moment v1 and v2 part, and those tests are updated with the decision.
- When a row for the record behind terms of office or the NBER's dates is signed, the files can
  be typed in and the layers appear on public Releases with no change of code; v1's set of the
  same name leaves the local Release at the same time.
- Splitting an Event that joins two happenings is a new file for each part and a new id; the
  old id stops resolving. No redirect exists for Events yet.
- The ingest image (`deploy/ingest.Dockerfile`) does not hold `content/`: its build context is an
  allowlist that is one of PLAN 6.1's checks, and M19 does not widen it. A Release written
  inside the image today has no Event, and its check report warns ("there is no directory
  …/content/events"). Letting `content/` into that image belongs with the job that runs it
  (M26), with the image scan extended to it.
- Event twins (`.json`, `.md`) and `events.json` in the Read API are M24's; search over Events
  is M22's; Events on topic pages are M23's.
- A pinned Explorer view (`pin=`) that follows an Event's "page" link leaves the pin: event
  pages render the current Release.

## Tests

`tests/v2/test_content_events.py` (the file format, the word list, the migration round trip,
ids and order, the review), `test_content_compile.py` (both Profiles, the date shapes, typed-in
layers, v1's layers), `test_publish_content.py` (a whole public Release holds no byte of a
draft; a later register; reuse), `test_content_check.py` (`atlas add event|note`, the content
layer), `test_capture_manual.py` (spans files), `checks/release-cases.json` through
`test_release.py` and `packages/core/src/release/release.test.ts` (the 0.3.0 rules, in both
languages); `site/src/lib/events.test.ts`, `site/e2e/events.spec.ts` (the pages: both base
paths, 320 px, both themes, JavaScript off); `site/src/lib/legacy/explorer.test.tsx` (M4's
annotation tests, unchanged, now over compiled content).
