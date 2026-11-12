# The Explorer's address, as of a date, pinned and saved

The Explorer draws what its address says and nothing else (ADR 0018). This note is the contract
for the parts M18 added: a common frequency, an as-of date, a pinned Release, saved queries, and
what a file of a view may hold. The choices behind it are ADR 0032.

## The address

```
/explore?s=gs10,gdp&mode=pch&from=2024-01&to=2026-11&freq=quarterly&as_of=2026-11-12
        &layers=rec&at=…&event=…&cmp=…&basis=lvl&lag=…&sx=…&sy=…&roll=24&ext=1&pin={release id}
```

| Field | Says |
|---|---|
| `s` | up to eight Series keys, in order |
| `mode` | `lin, log, rebase, z, pc1, drawdown, chg, ch1, pch, pca` (`docs/method/transforms.md`) |
| `from`, `to` | the window, as months |
| `freq` | `weekly, monthly, quarterly, annual`: every finer Series is combined to it |
| `as_of` | a date (before 00:00 New York that day) or an instant: what was known before it |
| `pin` | the Release the view is fixed to |

The rest are as before (ADR 0018, ADR 0019). "Copy link" gives the address with everything said
outright.

## Frequency

Each Series is drawn at its own frequency: a business-daily Series has one point a working day,
a quarterly one four a year. Nothing is laid on an axis of months.

With `freq=`, a Series finer than it is combined by the rule its Catalog entry declares, which
its Measure kind must allow (a rate is averaged, a flow summed, a stock taken last or averaged;
`transforms.md`, "Bringing a Series to a slower frequency"). The page names each Series so
combined and how. A Series at that frequency or slower is drawn as it is. A Series that
declares no rule is not drawn at another frequency.

In Relationships a pair is compared at the slower of its two frequencies, monthly at the
finest. A daily or weekly Series is combined to that frequency once, from its own Periods.

## As of a date

Every value in an as-of view is what the Release's history says was known before the Cutoff
(`vintage-resolution.md`). Each Series carries its Basis; the view claims the weakest among the
Series drawn. A Series with no answer for that date is named with the reason and has no value
anywhere on the page or in a file. The unit is the one in force then. The view says nothing
about today: no stale mark, no latest value.

## A pinned link

`pin=` fixes a view to one Release. The page says so, names the Release, and is drawn by
today's engine: a pin pins data, not the computation (PLAN 4.5).

| The Release named | Answer |
|---|---|
| is kept in the root (retention, a pin or a saved query keeps it) | 200, that Release's data, on every part of the page |
| is not a release id | 400 |
| is no longer kept (pruned, withdrawn, or never was) | 410 Gone, with a link to the same view on the current Release |
| cannot be read, breaks the contract, or may not be served on this Surface | 503 |

No other Release is ever shown in its place. A Release is kept by retention (the newest 30),
by `python -m atlas pin ID --profile P --reason WHY`, or by a saved query.

## Saved queries

```
python -m atlas save 'ADDRESS' --profile local --note "what this view is for"
python -m atlas save --list --profile local
python -m atlas save --remove ID --profile local
```

`ADDRESS` is the link "Copy link" gives (or its query string). It is read strictly: every part
as the Explorer writes it, in the Explorer's order, with Series, mode, window and layers said
outright. If it carries no `pin`, the view is pinned to the current Release. The Release is
checked as `atlas pin` checks one. The record goes into `{root}/saved.json`, and retention
keeps the Release it names for as long as the record is there.

Saved queries live in a local root only: a note is a person's own text and a public root holds
only what is published. The local site lists them on `/explore`, newest first.

## A file of a view

`/explore/export?format=csv|svg|all&…` asks the rights gate about each Series on its own, for
the Permission to redistribute, with everything it is computed from and, in an as-of view,
everything its history came through.

- Every Series permitted: the file holds the view.
- Some refused: the file holds the others, on the same window, and names each one left out
  with the reason (a `# Not in this file` line; "Not in this picture" in the drawing).
- None permitted: 403 with the reason. The page does not offer the links.

`format=all` is the Release as it is today and is refused (400) with an `as_of`. A file made on
the local Surface is stamped "not for publication".
