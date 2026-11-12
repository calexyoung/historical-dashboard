"""v1's Events (atlas/events.yaml) as files: content/events/{id}.md (PLAN M19; ADR 0033).

    python scripts/migrate_events.py            write content/events/*.md
    python scripts/migrate_events.py --out DIR  write them somewhere else (the test does)

Lossless: every v1 field goes over as it is (month and day -> date, title, cat -> category,
url -> the one citation), and `atlas.content.events.as_v1` turns each file back into v1's own
entry. Three things are added, none of them to v1's words:

- an id, the one the legacy converter already gave the Event's Annotation;
- an archived copy of the cited address, from scripts/event-archives.json, or the reason there
  is none;
- a status. An Event whose title hits the word list (atlas/content/wordlist.py), or that the
  review listed (content/events/migration-review.json), is a draft until Alex has decided its
  wording; the others are public. No title is reworded and no description is written.

It fetches nothing. Running it again writes the same bytes.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from atlas.content import events as E  # noqa: E402
from atlas.content import wordlist as W  # noqa: E402

NO_COPY = ("The Internet Archive's availability lookup returned no copy of this address on "
           "2026-11-12, the day v1's Events were migrated.")


def slug(text: str, limit: int = 60) -> str:
    """As atlas/legacy.py made Annotation ids before M19, so that every id is kept."""
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:limit].strip("-")


def migrate(v1_events: list[dict], archives: dict[str, str | None], listed: set[str]) -> list[dict]:
    out, seen = [], set()
    for v1 in v1_events:
        precision = "day" if v1.get("day") else "month"
        when = f"{v1['month']}-{int(v1['day']):02d}" if precision == "day" else v1["month"]
        identifier = f"{when}-{slug(v1['title'])}"
        if identifier in seen:
            raise SystemExit(f"two v1 Events would share the id {identifier}")
        seen.add(identifier)
        archive = archives[v1["url"]]
        source = {"url": v1["url"], **({"archive_url": archive} if archive else {"no_archive": NO_COPY})}
        hit = bool(W.terms_in(v1["title"])) or identifier in listed
        out.append({"id": identifier, "date": when, "date_precision": precision, "title": v1["title"],
                    "category": v1["cat"], "status": "draft" if hit else "public", "topics": [],
                    "related_series": [], "sources": [source], "description": ""})
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(E.EVENTS_DIR))
    args = parser.parse_args(argv)
    v1_events = yaml.safe_load((ROOT / "atlas" / "events.yaml").read_text(encoding="utf-8"))
    archives = json.loads((ROOT / "scripts" / "event-archives.json").read_text(encoding="utf-8"))["archives"]
    review = ROOT / "content" / "events" / "migration-review.json"
    listed = ({row["id"] for row in json.loads(review.read_text(encoding="utf-8"))["events"]
               if row["outcome"] == "listed"} if review.exists() else set())
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    events = migrate(v1_events, archives, listed)
    for event in events:
        (out / f"{event['id']}.md").write_text(E.serialise(event), encoding="utf-8")
    drafts = sum(1 for event in events if event["status"] == "draft")
    print(f"wrote {len(events)} Events to {out} ({drafts} draft, {len(events) - drafts} public)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
