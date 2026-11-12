"""The word list an Event's own text is held to (PLAN 5, M19; ADR 0033).

An Event says what happened and when. It never says one thing caused another and it does not
weigh what happened. A list of words cannot decide that; it can find the places a person must
look at. So the list is closed and literal: whole words and fixed phrases, any case, with no
exemption for a proper name. A hit in a ``public`` Event fails ``atlas check``; the way through
is another wording or, for a word that belongs to the thing's own name (the short title of an
Act), an entry in the Event's ``accepted_terms``, which only Alex adds.

Adding a term is a change to this file and to ``VERSION``.
"""
from __future__ import annotations

import re

VERSION = 1

CAUSAL = (
    "because", "cause", "caused", "causes", "causing", "due to", "owing to", "thanks to",
    "led to", "leads to", "leading to", "resulted in", "results in", "resulting in", "as a result",
    "triggered", "triggers", "triggering", "sparked", "sparks", "sparking", "prompted", "prompts",
    "prompting", "forced", "forces", "forcing", "drove", "drives", "driven by", "fueled", "fuelled",
    "fuels", "fuelling", "fueling", "blamed", "blames", "in response to", "in the wake of",
    "strains", "strained", "straining", "seizes", "seized", "amid",
)
EVALUATIVE = (
    "crisis", "crash", "crashes", "crashed", "collapse", "collapses", "collapsed", "plunge", "plunges",
    "plunged", "bubble", "bust", "disaster", "disastrous", "catastrophe", "catastrophic", "scandal",
    "tantrum", "shock", "shocks", "shocked", "panic", "turmoil", "chaos", "meltdown", "selloff",
    "sell-off", "rout", "spike", "spikes", "spiked", "surge", "surges", "surged", "soars", "soared",
    "soaring", "slump", "slumps", "slumped", "bailout", "rescue", "rescued", "rescues", "worst", "best",
    "historic", "unprecedented", "record", "massive", "huge", "dramatic", "landmark", "sweeping",
    "devastating", "disputed", "controversial", "failed", "failure", "botched", "successful",
    "success", "reckless", "bold", "beautiful", "volmageddon",
)
#: Every term, with its kind.
TERMS: dict[str, str] = {**{term: "causal" for term in CAUSAL}, **{term: "evaluative" for term in EVALUATIVE}}

_FIND = re.compile(
    r"(?<![A-Za-z0-9])(" + "|".join(re.escape(term).replace(r"\ ", r"\s+")
                                    for term in sorted(TERMS, key=len, reverse=True)) + r")(?![A-Za-z0-9])",
    re.IGNORECASE)


def terms_in(text: str) -> list[str]:
    """The terms of the list found in ``text``, each once, in the list's own spelling, sorted."""
    return sorted({re.sub(r"\s+", " ", match.lower()) for match in _FIND.findall(text or "")})


def event_terms(event: dict) -> dict[str, list[str]]:
    """Where an Event's own text hits the list: ``{"title": [...], "description": [...]}``,
    leaving out a field with no hit and every term the Event says is accepted."""
    accepted = {term.lower() for term in event.get("accepted_terms", [])}
    out = {}
    for name in ("title", "description"):
        found = [term for term in terms_in(event.get(name, "")) if term not in accepted]
        if found:
            out[name] = found
    return out
