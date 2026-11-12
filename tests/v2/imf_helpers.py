"""An answer of the IMF's SDMX 3.0 data API in the shape it served on 2026-11-11 (SDMX-JSON 2.0,
``dimensionAtObservation=TIME_PERIOD``), built from a plain description. Every value a test
puts in is invented."""
from __future__ import annotations

import json

CPI_DIMENSIONS = ("COUNTRY", "INDEX_TYPE", "COICOP_1999", "TYPE_OF_TRANSFORMATION", "FREQUENCY")
ER_DIMENSIONS = ("COUNTRY", "INDICATOR", "TYPE_OF_TRANSFORMATION", "FREQUENCY")
OBSERVATION_ATTRIBUTES = ("PRECISION", "DERIVATION_TYPE", "REFERENCE_PERIOD", "STATUS")
SERIES_ATTRIBUTES = ("SCALE", "DECIMALS_DISPLAYED", "OVERLAP", "COMMON_REFERENCE_PERIOD", "IFS_FLAG")
#: Attributes the Fund sends as an index into a list of codes; the others are sent as text.
CODED = ("SCALE", "OVERLAP", "DERIVATION_TYPE")


def answer(series: dict[str, dict], *, agency="IMF.STA", flow="CPI", version="5.0.0",
           dimensions=CPI_DIMENSIONS, observation_attributes=OBSERVATION_ATTRIBUTES,
           series_attributes=SERIES_ATTRIBUTES, times: list[str] | None = None) -> dict:
    """``series`` maps an SDMX key to ``{"obs": [(time, value, derivation, status)...],
    "reference": "2020A", "scale": "0"}``. Times are listed in the order first met unless
    ``times`` gives one (the Fund does not sort them)."""
    values = [[] for _ in dimensions]
    listed = list(times or [])
    codes: dict[str, list[str]] = {name: [] for name in CODED}

    def code(name: str, value):
        if value is None:
            return None
        if name not in CODED:
            return value
        if value not in codes[name]:
            codes[name].append(value)
        return codes[name].index(value)

    out = {}
    for key, spec in series.items():
        index = []
        for position, part in enumerate(key.split(".")):
            if part not in values[position]:
                values[position].append(part)
            index.append(str(values[position].index(part)))
        said = {"SCALE": spec.get("scale", "0"), "OVERLAP": "OL", "IFS_FLAG": "true",
                "COMMON_REFERENCE_PERIOD": spec.get("reference")}
        observations = {}
        for time, value, derivation, *rest in spec["obs"]:
            if time not in listed:
                listed.append(time)
            row = {"PRECISION": None, "DERIVATION_TYPE": derivation, "STATUS": rest[0] if rest else None,
                   "REFERENCE_PERIOD": spec.get("reference")}
            observations[str(listed.index(time))] = [value, *(code(name, row.get(name))
                                                              for name in observation_attributes)]
        out[":".join(index)] = {"attributes": [code(name, said.get(name)) for name in series_attributes],
                                "observations": observations}

    def described(names, related):
        return [{"id": name, "roles": [], "isMandatory": False, "relationship": related,
                 **({"values": [{"id": c} for c in codes[name]]} if codes.get(name) else {})}
                for name in names]

    structure = {
        "dataSets": [0],
        "links": [{"urn": f"urn:sdmx:org.sdmx.infomodel.datastructure.Dataflow={agency}:{flow}({version})",
                   "title": "Dataflow"},
                  {"urn": f"urn:sdmx:org.sdmx.infomodel.datastructure.DataStructure={agency}:DSD_{flow}({version})",
                   "title": "DataStructureDefinition"}],
        "dimensions": {
            "series": [{"id": name, "keyPosition": position, "roles": [], "values": [{"id": v} for v in values[position]]}
                       for position, name in enumerate(dimensions)],
            "observation": [{"id": "TIME_PERIOD", "keyPosition": len(dimensions),
                             "values": [{"value": time} for time in listed]}]},
        "measures": {"observation": [{"id": "OBS_VALUE", "roles": []}]},
        "attributes": {"dimensionGroup": [],
                       "series": described(series_attributes, {"dimensions": list(dimensions)}),
                       "observation": described(observation_attributes, {"observation": {}})},
        "annotations": [],
    }
    return {"meta": {}, "data": {"dataSets": [{"structure": 0, "action": "Replace", "series": out}],
                                 "structures": [structure]}}


def body(series: dict[str, dict], **how) -> bytes:
    return json.dumps(answer(series, **how), separators=(",", ":")).encode()
