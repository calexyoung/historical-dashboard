"""The headline Series (CONTEXT.md, Highlights, Overview; PLAN M22; ADR 0036).

``content/highlights.json`` in the repository is an editor's choice: for each Segment, the
Series that are rows of Highlights, in order; the first is the Segment's row of the Overview::

    {"segments": {"economy_jobs": ["unrate", "cpi_yoy"], "markets_money": ["fedfunds"]}}

It names Series and holds no value, and it grants nothing: a Series it names is shown only as
far as the rights gate allows, like any other. ``project()`` turns it into a Release's
``content/highlights.json``: all six Segments in the order of the Overview, each with the
Series of the declaration that this Release's Catalog holds *in that Segment*. A key the
Release does not hold, or holds under another Segment (v1's converter decides a Series'
Segment from v1's category), is left out and named in the check report.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..release import SEGMENTS

FILE = "highlights.json"
#: The most headline Series one Segment may have (the release contract's limit).
MOST = 24
_KEY = re.compile(r"[a-z][a-z0-9_]{0,63}")


def _no_repeats(pairs: list) -> dict:
    out = dict(pairs)
    if len(out) != len(pairs):
        raise ValueError("a name is given twice")
    return out


def read(body: bytes) -> tuple[dict[str, list[str]] | None, list[str]]:
    """The declaration as {segment: [keys]}, and what is wrong with it. None when it cannot
    be read at all."""
    try:
        document = json.loads(body.decode("utf-8"), object_pairs_hook=_no_repeats)
    except (ValueError, UnicodeDecodeError) as error:
        return None, [f"it is not JSON ({error})"]
    if not isinstance(document, dict) or set(document) != {"segments"} or not isinstance(document["segments"], dict):
        return None, ['it is not {"segments": {SEGMENT: [KEYS]}}']
    problems: list[str] = []
    seen: dict[str, str] = {}
    out: dict[str, list[str]] = {}
    for segment, keys in document["segments"].items():
        if segment not in SEGMENTS:
            problems.append(f"{segment} is not a Segment ({', '.join(SEGMENTS)})")
            continue
        if not isinstance(keys, list) or not all(isinstance(key, str) and _KEY.fullmatch(key) for key in keys):
            problems.append(f"{segment}: its Series are not a list of Series keys")
            continue
        if len(keys) > MOST:
            problems.append(f"{segment}: it names {len(keys)} Series and a Segment has at most {MOST}")
        for key in keys:
            if key in seen:
                problems.append(f"{key} is listed more than once ({seen[key]}, {segment})")
            seen[key] = segment
        out[segment] = list(keys)
    return out, problems


def load(content: Path) -> tuple[dict[str, list[str]], list[str], bytes | None]:
    """The repository's declaration under ``content``: ({segment: [keys]}, problems, the
    file's bytes). No file is no headline Series, and is not a problem."""
    path = Path(content) / FILE
    if not path.is_file():
        return {}, [], None
    body = path.read_bytes()
    declared, problems = read(body)
    return declared or {}, [f"{path}: {said}" for said in problems], body


def project(declared: dict[str, list[str]], entries: list[dict]) -> tuple[dict, list[str]]:
    """A Release's ``content/highlights.json`` from the declaration and the Release's own
    Catalog entries, and the keys left out, each with why."""
    segment_of = {entry["key"]: entry.get("segment") for entry in entries}
    left_out: list[str] = []
    rows = []
    for segment in SEGMENTS:
        kept = []
        for key in declared.get(segment, []):
            if key not in segment_of:
                left_out.append(f"{key} (not in this release)")
            elif segment_of[key] != segment:
                left_out.append(f"{key} (this release puts it in {segment_of[key]}, not {segment})")
            else:
                kept.append(key)
        rows.append({"segment": segment, "series": kept})
    return {"segments": rows}, left_out
