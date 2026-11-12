"""Saved queries (PLAN section 5 and M18; ADR 0032): an Explorer view kept with a Pin and a note.

``{root}/saved.json`` holds them, in a **local** root only. A note is a person's own text, and a
public root holds nothing that is not published (PLAN 4.3), so ``atlas save --profile public``
is refused; a public Release is kept for a link with ``atlas pin``.

A saved query is its own Pin: retention keeps every Release ``saved.json`` names (``root.prune``),
so there is one file and one write, and no second record that could disagree with it.

What may be saved is the link the Explorer's "Copy link" gives: everything said outright, in the
Explorer's one fixed order. ``canonical`` reads an address strictly and refuses anything it would
have to guess at. The site's parser is lenient, for links that arrive damaged; a record kept for
good is not. Both run ``checks/explorer-addresses.json``.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from . import root as R

MAX_NOTE, MAX_ADDRESS, MAX_SAVED, MAX_SERIES, MAX_LAG = 280, 2000, 500, 8, 24

MODES = ("lin", "log", "rebase", "z", "pc1", "drawdown", "chg", "ch1", "pch", "pca")
FREQUENCIES = ("weekly", "monthly", "quarterly", "annual")
#: The Explorer's one order (site/src/lib/explorer/state.ts, ``explorerQuery``). ``hi``, ``table``
#: and ``pick`` are states of a page, not of a view, and are not saved.
ORDER = ("s", "mode", "from", "to", "freq", "as_of", "layers", "at", "event", "cmp", "basis", "lag",
         "sx", "sy", "roll", "ext", "pin")
REQUIRED = ("s", "mode", "from", "to", "layers")

_KEY = r"[a-z][a-z0-9_]{0,63}"
_MONTH = r"\d{4}-(0[1-9]|1[0-2])"
_DAY = r"\d{4}-\d{2}-\d{2}"
_LAYER = r"(rec|pol|(ev|gov)(\.[a-z0-9_]{1,40})?)"
_SHAPES = {
    "s": rf"{_KEY}(,{_KEY})*",
    "mode": "|".join(MODES),
    "from": _MONTH, "to": _MONTH, "cmp": _MONTH,
    "freq": "|".join(FREQUENCIES),
    "as_of": rf"{_DAY}(T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ)?",
    "layers": rf"none|{_LAYER}(,{_LAYER})*",
    "at": _DAY,
    "event": r"[a-z0-9][a-z0-9_.-]{0,127}",
    "basis": "lvl",
    "lag": r"-?[1-9]\d?",
    "sx": _KEY, "sy": _KEY,
    "roll": "24",
    "ext": "1",
    "pin": r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}",
}


class NotSaved(ValueError):
    """Why an address may not be saved."""


def _real_day(text: str) -> bool:
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def canonical(address: str) -> tuple[str, str | None]:
    """(the view as the Explorer writes it, without a pin; the pin it carried or None).
    ``address`` is a whole address or its query string. Raises ``NotSaved``."""
    if len(address) > MAX_ADDRESS:
        raise NotSaved(f"the address is longer than {MAX_ADDRESS} characters")
    query = urlsplit(address).query if "?" in address or "://" in address else address
    if urlsplit(address).fragment or "#" in address:
        raise NotSaved("the address has a part after '#'; a saved query is an address of v2's Explorer")
    if not query.isascii():
        raise NotSaved("the address has a character the Explorer never writes")
    pairs = [part.partition("=") for part in query.split("&")] if query else []
    names = [name for name, _, _ in pairs]
    for name, sep, value in pairs:
        if name not in ORDER:
            raise NotSaved(f"{name!r} is not part of a saved view" if name else "the address has an empty part")
        if not sep or not re.fullmatch(_SHAPES[name], value, re.ASCII):
            raise NotSaved(f"{name}: not as the Explorer writes it")
    if len(set(names)) != len(names):
        raise NotSaved("a part of the address is given twice")
    if names != [name for name in ORDER if name in names]:
        raise NotSaved("the parts are not in the Explorer's order; save the link its \"Copy link\" gives")
    said = {name: value for name, _, value in pairs}
    missing = [name for name in REQUIRED if name not in said]
    if missing:
        raise NotSaved(f"the address does not say {', '.join(missing)}: a saved view says everything outright "
                       "(the link \"Copy link\" gives), so that it does not change when the defaults do")
    series = said["s"].split(",")
    if len(set(series)) != len(series) or len(series) > MAX_SERIES:
        raise NotSaved(f"s: at most {MAX_SERIES} series, each once")
    if said["from"] > said["to"]:
        raise NotSaved("the window ends before it starts")
    if any(said.get(name, "1").startswith("0000") for name in ("from", "to", "cmp")):
        raise NotSaved("a month in year 0000 is not a month")
    layers = said["layers"].split(",")
    if len(set(layers)) != len(layers):
        raise NotSaved("layers: a layer is named twice")
    if "as_of" in said and (not _real_day(said["as_of"][:10]) or said["as_of"][:10] < "1900-01-01"):
        raise NotSaved("as_of: a calendar date from 1900 on")
    if "at" in said and not _real_day(said["at"]):
        raise NotSaved("at: a calendar date")
    if "lag" in said and abs(int(said["lag"])) > MAX_LAG:
        raise NotSaved(f"lag: from -{MAX_LAG} to {MAX_LAG}")
    pin = said.pop("pin", None)
    return "&".join(f"{name}={said[name]}" for name in ORDER if name in said), pin


def note_problem(note: str) -> str | None:
    if not note.strip():
        return "a saved query has a note: what the view is for"
    if len(note) > MAX_NOTE:
        return f"the note is longer than {MAX_NOTE} characters"
    if any(ord(c) < 32 or ord(c) == 127 for c in note):
        return "the note has a control character in it (one line of plain text)"
    return None


def read(root: Path) -> list[dict]:
    return R.saved(root)


def new_id(view: str, release_id: str, note: str, saved_at: str) -> str:
    digest = hashlib.sha256("\n".join((view, release_id, note, saved_at)).encode()).hexdigest()
    return f"sq-{saved_at[:10].replace('-', '')}-{digest[:8]}"


def write(root: Path, entries: list[dict]) -> None:
    R.replace_json(Path(root) / R.SAVED, {"format": R.FORMAT, "saved": entries})
