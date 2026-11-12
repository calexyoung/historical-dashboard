"""Answers of the BEA API and of the EIA's API v2 in the shapes they served on 2026-11-11, built
from plain descriptions. Every value a test puts in is invented."""
from __future__ import annotations

import json

BEA_URL = "https://apps.bea.gov/api/data"
EIA_URL = "https://api.eia.gov/v2"


def nipa(lines: list[dict], *, table="T10106", frequency="Q", dataset="NIPA", note=None, year="ALL",
         user="REDACTED") -> dict:
    """``lines``: ``{"code", "line", "name", "unit", "mult", "metric", "obs": [(time, value)...]}``."""
    data = [{"TableName": table, "SeriesCode": line["code"], "LineNumber": line["line"],
             "LineDescription": line.get("name", "A line"), "TimePeriod": time,
             "METRIC_NAME": line.get("metric", "Chained Dollars"), "CL_UNIT": line.get("unit", "Level"),
             "UNIT_MULT": line.get("mult", "6"), "DataValue": value, "NoteRef": table}
            for line in lines for time, value in line["obs"]]
    if note is None:
        note = "Table 1.1.6. An Invented Table, Chained Dollars [Billions of chained (2017) dollars] - LastRevised: October 29, 2026"
    return {"BEAAPI": {
        "Request": {"RequestParam": [
            {"ParameterName": "USERID", "ParameterValue": user},
            {"ParameterName": "RESULTFORMAT", "ParameterValue": "JSON"},
            {"ParameterName": "METHOD", "ParameterValue": "GETDATA"},
            {"ParameterName": "DATASETNAME", "ParameterValue": dataset.upper()},
            {"ParameterName": "TABLENAME", "ParameterValue": table.upper()},
            {"ParameterName": "FREQUENCY", "ParameterValue": frequency},
            {"ParameterName": "YEAR", "ParameterValue": year}]},
        "Results": {"Statistic": "NIPA Table", "UTCProductionTime": "2026-11-11T15:50:00.000",
                    "Dimensions": [{"Ordinal": "1", "Name": "TableName", "DataType": "string", "IsValue": "0"}],
                    "Data": data,
                    "Notes": [{"NoteRef": table, "NoteText": note}]}}}


def ita(obs: list[tuple[str, str]], *, indicator="BalGdsServ", area="AllCountries", frequency="QSA",
        series="TSI_ItaBalGdsServ_QSA", unit="USD", mult="6") -> dict:
    data = [{"Indicator": indicator, "AreaOrCountry": area, "Frequency": frequency, "Year": time[:4],
             "TimeSeriesId": series, "TimeSeriesDescription": "An invented balance", "TimePeriod": time,
             "CL_UNIT": unit, "UNIT_MULT": mult, "DataValue": value, "NoteRef": "Q"}
            for time, value in obs]
    return {"BEAAPI": {
        "Request": {"RequestParam": [
            {"ParameterName": "USERID", "ParameterValue": "REDACTED"},
            {"ParameterName": "RESULTFORMAT", "ParameterValue": "JSON"},
            {"ParameterName": "METHOD", "ParameterValue": "GETDATA"},
            {"ParameterName": "DATASETNAME", "ParameterValue": "ITA"},
            {"ParameterName": "INDICATOR", "ParameterValue": indicator.upper()},
            {"ParameterName": "AREAORCOUNTRY", "ParameterValue": area.upper()},
            {"ParameterName": "FREQUENCY", "ParameterValue": frequency},
            {"ParameterName": "YEAR", "ParameterValue": "ALL"}]},
        "Results": {"TsLastUpdated": "2026-09-24 08:30:00.000", "Dimensions": [], "Data": data,
                    "Notes": {"NoteRef": "Q", "NoteText": "Quarterly estimates are not annualized."}}}}


def bea_error(code="201", text="Error retrieving NIPA data.", detail="Invalid TableName was requested.") -> dict:
    return {"BEAAPI": {"Request": {"RequestParam": [{"ParameterName": "USERID", "ParameterValue": "REDACTED"}]},
                       "Error": {"APIErrorDescription": text, "APIErrorCode": code,
                                 "ErrorDetail": {"Description": detail}}}}


def eia(rows: list[dict], *, route="petroleum/pri/spt", frequency="monthly", total=None, offset=0,
        length=5000, column="value", warnings=None) -> dict:
    """``rows`` are the rows of one page, as the API lists them."""
    out = {"response": {"total": str(len(rows) if total is None else total),
                        "dateFormat": {"monthly": "YYYY-MM", "weekly": "YYYY-MM-DD"}.get(frequency, "YYYY"),
                        "frequency": frequency, "data": rows},
           "request": {"command": f"/v2/{route}/data/",
                       "params": {"frequency": frequency, "data": [column], "offset": str(offset),
                                  "length": str(length)}},
           "apiVersion": "2.1.14", "ExcelAddInVersion": "2.1.0"}
    if warnings:
        out = {"warnings": warnings, **out}
    return out


def spot(series: str, period: str, value, units="$/BBL") -> dict:
    return {"period": period, "duoarea": "YCUOK", "area-name": "NA", "product": "EPCWTI",
            "product-name": "An invented crude", "process": "PF4", "process-name": "Spot Price FOB",
            "series": series, "series-description": "An invented price (Dollars per Barrel)",
            "value": value, "units": units}


def generation(fuel: str, period: str, value, units="thousand megawatthours") -> dict:
    return {"period": period, "location": "US", "stateDescription": "U.S. Total", "sectorid": "99",
            "sectorDescription": "All Sectors", "fueltypeid": fuel, "fuelTypeDescription": "all fuels",
            "generation": value, "generation-units": units}


def body(answer: dict) -> bytes:
    return json.dumps(answer).encode()
