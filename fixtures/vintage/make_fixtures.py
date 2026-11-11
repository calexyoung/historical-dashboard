"""Writes the vintage store's committed fixture: three recorded fetches of one endpoint, a
month apart, in the shape of a BLS answer (PLAN M8 acceptance).

    three-fetch/1-initial/      two Series, two months each
    three-fetch/2-revision/     a month is added to both; one Series revises a value and a Status
    three-fetch/3-withdrawal/   one Series loses a month it had; the other is unchanged

Every value is invented, and so are the Series: the Origin is "Macro Atlas fixture
(synthetic)", not the Bureau of Labor Statistics. Only the *shape* of the answer is BLS's, so
that the real adapter parses it. The repository is public and no row of the rights register is
signed, so real agency bytes may not be committed (PLAN 6.1).

``register()`` is the table the fixture is replayed under. Its one row and that row's decision
are test data about a made-up Origin: they are not in schema/rights-register.json and say
nothing about what Alex has decided for any real source.

    python fixtures/vintage/make_fixtures.py        # rewrite fixtures/vintage/three-fetch/
"""
from __future__ import annotations

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from atlas.capture.adapters import capture
from atlas.capture.http import Fetch, Response, Session
from atlas.capture.replay import write_exchange
from atlas.capture.run import endpoints_from_register
from atlas.capture.store import stamp

ORIGIN = "Macro Atlas fixture (synthetic)"
NOTE = ("Invented values for invented Series, in the shape of a BLS answer. Not a measurement "
        "of anything and not a capture: written by fixtures/vintage/make_fixtures.py.")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
P = "preliminary"

#: Each fetch: its directory, when the recorded run began (the answer arrives a second later),
#: and for each Series the months it lists as (month, value, preliminary?).
FETCHES = [
    ("1-initial", datetime(2026, 3, 10, 13, 30, 0, tzinfo=UTC), {
        "FXPRICE0001": [(1, "100.000", None), (2, "100.400", None)],
        "FXJOBS00001": [(1, "150000", P), (2, "150120", P)],
    }),
    ("2-revision", datetime(2026, 4, 10, 12, 30, 0, tzinfo=UTC), {
        "FXPRICE0001": [(1, "100.000", None), (2, "100.400", None), (3, "100.900", None)],
        "FXJOBS00001": [(1, "150010", None), (2, "150120", P), (3, "150300", P)],
    }),
    ("3-withdrawal", datetime(2026, 5, 12, 12, 30, 0, tzinfo=UTC), {
        "FXPRICE0001": [(1, "100.000", None), (3, "100.900", None), (4, "101.300", None)],
        "FXJOBS00001": [(1, "150010", None), (2, "150120", P), (3, "150300", P)],
    }),
]


def register() -> dict:
    """The register the fixture is replayed under: one made-up Origin, cleared as test data."""
    return {
        "format": 1, "version": "fixture-vintage-1",
        "about": "Test data for fixtures/vintage. Not the rights register.",
        "cleared_intermediaries": [],
        "rows": [{
            "id": "fx", "kind": "origin", "name": "Vintage fixture", "origins": [ORIGIN],
            "datasets": ["fixture prices", "fixture jobs"], "used_for": "the vintage store's tests",
            "terms": [], "licence_class": "public_domain",
            "attribution": "Synthetic test data, Macro Atlas project",
            "proposal": {"display": True, "redistribute": True, "store": True, "ml_use": True,
                         "note": "invented values"},
            "open_questions": [],
            "decision": {"display": True, "redistribute": True, "store": True, "ml_use": True,
                         "signed_by": "Alex", "signed_on": "2026-01-01"},
            "capture": [{
                "id": "fx-bls-shape", "adapter": "bls", "channel": "fixture",
                "datasets": ["fixture prices", "fixture jobs"],
                "params": {"series": ["FXPRICE0001", "FXJOBS00001"], "years": 1},
            }],
        }],
    }


def body(series: dict) -> bytes:
    listed = []
    for series_id, months in series.items():
        rows = []
        for index, (month, value, preliminary) in enumerate(reversed(months)):  # newest first
            row = {"year": "2026", "period": f"M{month:02d}", "periodName": MONTHS[month - 1]}
            if index == 0:
                row["latest"] = "true"
            row["value"] = value
            row["footnotes"] = [{"code": "P", "text": preliminary}] if preliminary else [{}]
            rows.append(row)
        listed.append({"seriesID": series_id, "data": rows})
    compact = json.dumps(listed, separators=(",", ":"))
    return ('{"status":"REQUEST_SUCCEEDED","responseTime":62,"message":[],"Results":{\n'
            f'"series":\n{compact}\n}}}}').encode()


class Synthetic:
    """Serves one invented body to the real adapter, a second after the run began."""

    kind = "synthetic"
    real = False

    def __init__(self, began: datetime, answer: bytes):
        self._began, self._answer = began, answer

    def now(self):
        return self._began

    def send(self, request):
        arrived = self._began + timedelta(seconds=1)
        headers = [["Content-Type", "application/json"],
                   ["Date", arrived.strftime("%a, %d %b %Y %H:%M:%S GMT")],
                   ["Content-Length", str(len(self._answer))]]
        return Response(200, headers, self._answer, arrived)


def build(out: Path) -> list[str]:
    (endpoint,) = endpoints_from_register(register())
    written = []
    for name, began, series in FETCHES:
        transport = Synthetic(began, body(series))
        raw = capture(endpoint, Fetch(Session(transport, sleep=lambda seconds: None)))
        assert raw.evidence.complete, (name, raw.evidence.problems)
        parts = [{"request": {"method": p.request.method, "url": p.request.url,
                              "body": None if p.request.body is None else p.request.body.decode()},
                  "status": p.response.status, "headers": p.response.headers,
                  "received_at": stamp(p.response.received_at), "body": p.response.body}
                 for p in raw.parts]
        write_exchange(out / name, endpoint.source, endpoint.id, parts, recorded_at=began,
                       provenance={"synthetic": True, "transport": transport.kind,
                                   "origin": endpoint.origin, "datasets": list(endpoint.datasets),
                                   "retrieved_at": stamp(raw.retrieved_at), "capture_id": None,
                                   "note": NOTE})
        written.append(name)
    return written


if __name__ == "__main__":
    for name in build(Path(__file__).resolve().parent / "three-fetch"):
        print("wrote", name)
