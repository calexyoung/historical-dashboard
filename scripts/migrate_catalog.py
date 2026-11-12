"""The one-off migration of v1's catalog into Catalog v2 (PLAN M12; ADR 0026).

    .venv/bin/python scripts/migrate_catalog.py            # writes catalog/series/{key}.json
    .venv/bin/python scripts/migrate_catalog.py --check    # says what would change, writes nothing

It reads v1's ``atlas/catalog.yaml`` (109 entries) and the table of proposals below, and writes
one Series file per v1 series: the 108 that v1 fetched, its one ratio, its 14 year-over-year
series and the three it entered by hand. ``cpi_nsa`` (added in M8, never in v1) is written too.
v1's keys are kept exactly.

What comes from v1: the key, the name, the category (as Segment and topic), the staleness limit,
the sanity range, and which series are computed from which. What is written here by hand, per
key: the Origin (producer, dataset, identifier, address), the Channel proposed, the native
frequency, the unit in words, the adjustment and price basis, the country, and how the proposed
figure relates to the one v1 showed. Nothing here states Rights or a Permission: those are
looked up in the rights register when the Catalog is read.

A proposal is not a finding. An identifier marked ``None`` is one this migration does not know
well enough to write down; the milestone that builds the adapter settles it with a captured
fixture (PLAN 6, "Still unverified"). After the migration the Series files are the Catalog and
are edited directly (``python -m atlas add series``, ``python -m atlas check``); this script is
kept as the record of how they were first written and is not run again once they diverge.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from atlas.legacy import SEGMENT_OF_CATEGORY, _measure_kind, _slug, _unit_kind

OUT = ROOT / "catalog" / "series"

# --- Origins. A name the rights register has a row for is written exactly as the row has it. ---
BLS = "U.S. Bureau of Labor Statistics"
BEA = "U.S. Bureau of Economic Analysis"
CENSUS = "U.S. Census Bureau"
TREASURY = "U.S. Department of the Treasury, Bureau of the Fiscal Service"
FED = "Board of Governors of the Federal Reserve System"
EIA = "U.S. Energy Information Administration"
IMF = "International Monetary Fund"
OECD = "Organisation for Economic Co-operation and Development"
WORLD_BANK = "World Bank"
EUROSTAT = "Eurostat"
GALLUP = "Gallup"
# Origins with no row in the register yet. Each needs one before anything can be decided.
ONS = "Office for National Statistics (United Kingdom)"
ECB = "European Central Bank"
NY_FED = "Federal Reserve Bank of New York"
DOL = "U.S. Department of Labor, Employment and Training Administration"
FREDDIE = "Freddie Mac"
EPU = "Economic Policy Uncertainty (Baker, Bloom and Davis)"
NBER = "National Bureau of Economic Research"
FEC = "Federal Election Commission"
UMICH = "University of Michigan, Surveys of Consumers"

FREQ = {"M": "monthly", "W": "weekly", "D": "business_daily", "Q": "quarterly", "A": "annual"}
REFRESH = {"M": "monthly", "W": "weekly", "D": "daily", "Q": "quarterly", "A": "annual"}
PER_YEAR = {"monthly": 12, "quarterly": 4, "annual": 1}

UNIT_WORDS = {
    "thousands": "thousands",
    "%": "percent", "pp": "percentage points", "index": "index", "$": "U.S. dollars",
    "$mn": "millions of U.S. dollars", "$bn": "billions of U.S. dollars",
    "$/bbl": "U.S. dollars per barrel", "$/oz": "U.S. dollars per troy ounce",
    "$/lb": "U.S. dollars per pound", "$/gal": "U.S. dollars per gallon",
    "$/MMBtu": "U.S. dollars per million Btu", "$/doz": "U.S. dollars per dozen",
    "$/hr": "U.S. dollars per hour", "€mn": "millions of euros", "€/oz": "euros per troy ounce",
    "index 1982-84=100": "index, 1982-84 = 100", "index 2015=100": "index, 2015 = 100",
    "index 2000=100": "index, January 2000 = 100", "index 2016=100": "index, 2016 = 100",
    "index 2017=100": "index, 2017 = 100", "index Jan 2006=100": "index, January 2006 = 100",
    "index 0–100": "index, 0 to 100", "$ per €": "U.S. dollars per euro",
    "$ per £": "U.S. dollars per pound sterling", "₹ per $": "Indian rupees per U.S. dollar",
    "C$ per $": "Canadian dollars per U.S. dollar", "R$ per $": "Brazilian reais per U.S. dollar",
    "MX$ per $": "Mexican pesos per U.S. dollar", "₺ per $": "Turkish lira per U.S. dollar",
    "years": "years", "per 1,000": "births per 1,000 people", "0/1": "indicator, 1 = recession",
    "persons/week": "initial claims per week", "1982-84 $": "1982-84 U.S. dollars per week",
}
BASE = {"index 1982-84=100": "1982-84", "index 2015=100": "2015", "index 2000=100": "2000-01",
        "index 2016=100": "2016", "index 2017=100": "2017", "index Jan 2006=100": "2006-01"}

LICENSED_INDEX = ("Index levels are licensed by their owner on every free channel found; the "
                  "register's Yahoo row proposes no display (PLAN D5).")
MARKET_PRICE = ("An exchange-traded price. No origin-agency route has been found, and v1's "
                "channel (Yahoo) is proposed for no display.")


def src(producer, dataset, origin_id, url, **more):
    """A proposed Source over a direct Channel, and what else the entry says."""
    return {"producer": producer, "dataset": dataset, "origin_id": origin_id, "url": url, **more}


def none(producer, dataset, origin_id, kind, reason, **more):
    """No Channel: the Series stays in the Catalog and is withheld."""
    return {"producer": producer, "dataset": dataset, "origin_id": origin_id, "url": None,
            "no_channel": {"kind": kind, "reason": reason}, **more}


def bls(dataset, origin_id, **more):
    return src(BLS, dataset, origin_id, f"https://data.bls.gov/timeseries/{origin_id}",
               milestone="M13", **more)


H15 = "https://www.federalreserve.gov/releases/h15/"
H10 = "https://www.federalreserve.gov/releases/h10/"
UNSETTLED = "The agency's identifier for this series is settled, with a captured fixture, by the milestone that builds the adapter."


def fed(dataset, origin_id, url, **more):
    return src(FED, dataset, origin_id, url, milestone="M13", **more)


def h10(origin_id, country, unit=None, **more):
    return fed("H.10 Foreign Exchange Rates", origin_id, H10, sa="not_applicable", pb="nominal",
               country=country, **({"unit": unit} if unit else {}), **more)


def index_level(producer, dataset, origin_id, country):
    return none(producer, dataset, origin_id, "rights_restriction", LICENSED_INDEX,
                sa="not_applicable", pb="nominal", country=country, freq="monthly", refresh="none",
                description="Month-end close.")


def market_price(producer, dataset, origin_id, country="USA", **more):
    return none(producer, dataset, origin_id, "no_route_established", MARKET_PRICE,
                sa="not_applicable", pb="nominal", country=country, freq="monthly", refresh="none",
                agg="none", description="Month-end close.", **more)


def oecd(dataset, country, **more):
    more = {"sa": "sa", "pb": "not_applicable", **more}
    return src(OECD, dataset, None, "https://data-explorer.oecd.org/", country=country,
               milestone="v2.2", **more)


def eurostat(dataset, origin_id, country, **more):
    return src(EUROSTAT, dataset, origin_id,
               f"https://ec.europa.eu/eurostat/databrowser/view/{dataset.split(' ')[0]}/default/table",
               country=country, milestone="v2.2", **more)


def world_bank(indicator, country, **more):
    return src(WORLD_BANK, "World Development Indicators", indicator,
               f"https://data.worldbank.org/indicator/{indicator}?locations={country[:2]}",
               sa="not_applicable", country=country, milestone="v2.2", **more)


INTERBANK = ("The register has no proposal to allow OECD data until its terms are read. A central "
             "bank policy rate from the BIS (v2.2) is a different quantity and would take a new key.")

# sa: seasonal_adjustment. pb: price_basis. change: how the proposed figure relates to v1's
# (default "same"). Anything else overrides what v1's entry gives.
PROPOSALS: dict[str, dict] = {
    # --- US markets and global markets: index levels and traded prices (v1: Yahoo) ---
    "spx": index_level("S&P Dow Jones Indices", "S&P 500", "SPX", "USA"),
    "nasdaq": index_level("Nasdaq", "Nasdaq Composite", "COMP", "USA"),
    "dow": index_level("S&P Dow Jones Indices", "Dow Jones Industrial Average", "DJI", "USA"),
    "rut": index_level("FTSE Russell", "Russell 2000", "RUT", "USA"),
    "vix": index_level("Cboe Global Markets", "Cboe Volatility Index", "VIX", "USA"),
    "sox": index_level("Nasdaq", "PHLX Semiconductor Sector Index", "SOX", "USA"),
    "ndx": index_level("Nasdaq", "Nasdaq-100", "NDX", "USA"),
    "dax": index_level("Deutsche Börse (STOXX)", "DAX", "DAX", "DEU"),
    "ftse": index_level("FTSE Russell", "FTSE 100", "UKX", "GBR"),
    "stoxx": index_level("STOXX", "EURO STOXX 50", "SX5E", "EA"),
    "nikkei": index_level("Nikkei Inc.", "Nikkei 225", "N225", "JPN"),
    "shanghai": index_level("Shanghai Stock Exchange", "SSE Composite Index", "000001", "CHN"),
    "hsi": index_level("Hang Seng Indexes", "Hang Seng Index", "HSI", "HKG"),
    "kospi": index_level("Korea Exchange", "KOSPI", "KOSPI", "KOR"),
    "sensex": index_level("BSE (Asia Index)", "S&P BSE Sensex", "SENSEX", "IND"),
    "tsx": index_level("S&P Dow Jones Indices (TMX)", "S&P/TSX Composite", "TSX", "CAN"),
    "dxy": index_level("ICE Futures U.S.", "U.S. Dollar Index", "DXY", "USA"),
    "acwi": market_price("iShares (BlackRock)", "iShares MSCI ACWI ETF", "ACWI", "WLD"),
    "eem": market_price("iShares (BlackRock)", "iShares MSCI Emerging Markets ETF", "EEM", "WLD"),
    "xle": market_price("State Street Global Advisors", "Energy Select Sector SPDR Fund", "XLE"),
    "xlf": market_price("State Street Global Advisors", "Financial Select Sector SPDR Fund", "XLF"),
    "xlk": market_price("State Street Global Advisors", "Technology Select Sector SPDR Fund", "XLK"),
    "tlt": market_price("iShares (BlackRock)", "iShares 20+ Year Treasury Bond ETF", "TLT"),
    "gold": market_price("CME Group (COMEX)", "Gold futures, front contract", "GC", "WLD",
                         note="The IMF's Primary Commodity Prices carry a monthly average gold "
                              "price: a different quantity from a month-end futures close, which "
                              "would take a new key."),
    "copper": market_price("CME Group (COMEX)", "Copper futures, front contract", "HG", "WLD",
                           note="The IMF's Primary Commodity Prices carry a monthly average copper "
                                "price: a different quantity, which would take a new key."),
    "btc": market_price("No single Origin (exchange prices)", "Bitcoin in U.S. dollars", "BTC-USD", "WLD"),
    # --- commodities and energy ---
    "wti": src(EIA, "Petroleum and Other Liquids: Spot Prices", "RWTC",
               "https://www.eia.gov/dnav/pet/pet_pri_spt_s1_m.htm", sa="not_applicable", pb="nominal",
               country="USA", milestone="M15",
               note="The EIA publishes spot prices it takes from a commercial provider; whether "
                    "the EIA's terms cover them is a question for the eia-spot-prices row of the register."),
    "brent": src(EIA, "Petroleum and Other Liquids: Spot Prices", "RBRTE",
                 "https://www.eia.gov/dnav/pet/pet_pri_spt_s1_m.htm", sa="not_applicable", pb="nominal",
                 country="WLD", milestone="M15",
                 note="The EIA publishes spot prices it takes from a commercial provider; whether "
                      "the EIA's terms cover them is a question for the eia-spot-prices row of the register."),
    "gas": src(EIA, "Gasoline and Diesel Fuel Update", "EMM_EPMR_PTE_NUS_DPG",
               "https://www.eia.gov/petroleum/gasdiesel/", sa="not_applicable", pb="nominal",
               country="USA", milestone="M15", description="U.S. regular, all formulations, retail, weekly."),
    "natgas": src(EIA, "Natural Gas Spot and Futures Prices", "RNGWHHD",
                  "https://www.eia.gov/dnav/ng/ng_pri_fut_s1_m.htm", sa="not_applicable", pb="nominal",
                  country="USA", milestone="M15",
                  note="The EIA publishes spot prices it takes from a commercial provider; whether "
                       "the EIA's terms cover them is a question for the eia-spot-prices row of the register."),
    "eggs": bls("Average Price Data", "APU0000708111", sa="nsa", pb="nominal", country="USA"),
    "food": src(IMF, "Primary Commodity Price System", None, "https://www.imf.org/en/Research/commodity-prices",
                sa="not_applicable", pb="nominal", country="WLD", milestone="v2.2", note=UNSETTLED),
    # --- US economy ---
    "unrate": bls("Current Population Survey", "LNS14000000", sa="sa", pb="not_applicable", country="USA"),
    "cpi": bls("Consumer Price Index", "CUSR0000SA0", sa="sa", pb="not_applicable", country="USA"),
    "corecpi": bls("Consumer Price Index", "CUSR0000SA0L1E", sa="sa", pb="not_applicable", country="USA",
                   unit="index, 1982-84 = 100", base="1982-84"),
    "gdp": src(BEA, "National Income and Product Accounts, Table 1.1.6", "A191RX",
               "https://www.bea.gov/data/gdp/gross-domestic-product", sa="saar", pb="real",
               country="USA", milestone="M15", unit="billions of chained 2017 U.S. dollars, annual rate",
               base="2017"),
    "gdp_qoq": src(BEA, "National Income and Product Accounts, Table 1.1.1", "A191RL",
                   "https://www.bea.gov/data/gdp/gross-domestic-product", sa="saar", pb="real",
                   country="USA", milestone="M15",
                   unit="percent change from the preceding quarter, annual rate"),
    "payems": bls("Current Employment Statistics", "CES0000000001", sa="sa", pb="not_applicable", country="USA"),
    "claims": src(DOL, "Unemployment Insurance Weekly Claims", None, "https://oui.doleta.gov/unemploy/claims.asp",
                  sa="sa", pb="not_applicable", country="USA", agg="sum", note=UNSETTLED),
    "saving": src(BEA, "National Income and Product Accounts, Table 2.6", "A072RC",
                  "https://www.bea.gov/data/income-saving/personal-saving-rate", sa="saar",
                  pb="not_applicable", country="USA", milestone="M15"),
    "m2": fed("H.6 Money Stock Measures", None, "https://www.federalreserve.gov/releases/h6/",
              sa="sa", pb="nominal", country="USA", note=UNSETTLED),
    "fedassets": fed("H.4.1 Factors Affecting Reserve Balances", None,
                     "https://www.federalreserve.gov/releases/h41/", sa="nsa", pb="nominal",
                     country="USA", note=UNSETTLED),
    "debtgdp": none("No single Origin (v1 used a ratio the Federal Reserve Bank of St. Louis computes)",
                    "Federal debt as a percent of gross domestic product", "GFDEGDQ188S",
                    "no_route_established",
                    "No agency publishes this quarterly ratio. It can be a Recipe over debt and "
                    "nominal GDP once the Catalog holds nominal GDP (M15) and the engine has a "
                    "ratio in percent; neither exists yet.",
                    sa="sa", pb="not_applicable", country="USA", refresh="none", agg="none"),
    "debt": src(TREASURY, "Debt to the Penny", "tot_pub_debt_out_amt",
                "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/", sa="not_applicable",
                pb="nominal", country="USA", milestone="M13", freq="business_daily", refresh="daily",
                unit="U.S. dollars", agg="last", change="representation",
                note="v1 showed the quarter-end figure in millions of dollars; the Treasury "
                     "publishes the same total each business day in dollars."),
    "civpart": bls("Current Population Survey", "LNS11300000", sa="sa", pb="not_applicable", country="USA"),
    "wages": bls("Current Employment Statistics", "CES0500000008", sa="sa", pb="nominal", country="USA"),
    "trade": src(BEA, "U.S. International Trade in Goods and Services (FT-900, with the Census Bureau)",
                 None, "https://www.bea.gov/data/intl-trade-investment/international-trade-goods-and-services",
                 sa="sa", pb="nominal", country="USA", milestone="M15", agg="sum", note=UNSETTLED),
    "retail": src(CENSUS, "Monthly Retail Trade", "44X72",
                  "https://www.census.gov/retail/sales.html", sa="sa", pb="nominal", country="USA",
                  milestone="M16", agg="sum"),
    "indpro": fed("G.17 Industrial Production and Capacity Utilization", None,
                  "https://www.federalreserve.gov/releases/g17/", sa="sa", pb="not_applicable", country="USA",
                  unit="index, 2017 = 100", base="2017", note=UNSETTLED),
    "profits": src(BEA, "National Income and Product Accounts, Table 1.12", "A055RC",
                   "https://www.bea.gov/data/income-saving/corporate-profits", sa="saar", pb="nominal",
                   country="USA", milestone="M15", unit="billions of U.S. dollars, annual rate",
                   description="Corporate profits after tax, without inventory valuation and "
                               "capital consumption adjustments."),
    "income": src(CENSUS, "Historical Income Tables: Households (Current Population Survey, Annual "
                          "Social and Economic Supplement)", None,
                  "https://www.census.gov/data/tables/time-series/demo/income-poverty/historical-income-households.html",
                  sa="not_applicable", pb="real", country="USA", milestone="M16", unit="U.S. dollars, at the prices of the latest year",
                  note=UNSETTLED + " The base year of the real figure moves with each annual release."),
    "gini": world_bank("SI.POV.GINI", "USA", pb="not_applicable"),
    "life_exp": world_bank("SP.DYN.LE00.IN", "USA", pb="not_applicable"),
    "births": world_bank("SP.DYN.CBRT.IN", "USA", pb="not_applicable"),
    "real_wages": bls("Current Population Survey", "LES1252881600", sa="sa", pb="real", country="USA", base="1982-84"),
    "labor_share": bls("Productivity and Costs", "PRS85006173", sa="sa", pb="not_applicable", country="USA"),
    "usrec": src(NBER, "US Business Cycle Expansions and Contractions", None,
                 "https://www.nber.org/research/data/us-business-cycle-expansions-and-contractions",
                 via="hand_entered", sa="not_applicable", pb="not_applicable", country="USA", refresh="irregular",
                 milestone="M19", change="representation",
                 note="v1 took a monthly 0/1 indicator from FRED, which computes it from the "
                      "NBER's dates. The dates themselves are entered by hand, each with its "
                      "citation, when recessions become an Annotation layer."),
    # --- rates and money ---
    "fedfunds": fed("H.15 Selected Interest Rates", "RIFSPFF_N.M", H15, sa="not_applicable",
                    pb="nominal", country="USA"),
    "gs10": fed("H.15 Selected Interest Rates", "RIFLGFCY10_N.B", H15, sa="not_applicable", pb="nominal",
                country="USA", freq="business_daily", refresh="daily", change="representation",
                note="v1 showed the monthly average; the Board publishes the yield each business day, "
                     "and the monthly figure is the mean of those days."),
    "gs2": fed("H.15 Selected Interest Rates", "RIFLGFCY02_N.B", H15, sa="not_applicable", pb="nominal",
               country="USA", freq="business_daily", refresh="daily", change="representation",
               note="v1 showed the monthly average; the Board publishes the yield each business day, "
                    "and the monthly figure is the mean of those days."),
    "mortgage": src(FREDDIE, "Primary Mortgage Market Survey", None, "https://www.freddiemac.com/pmms",
                    sa="nsa", pb="nominal", country="USA", note=UNSETTLED),
    "credit": fed("G.19 Consumer Credit", None, "https://www.federalreserve.gov/releases/g19/", sa="sa",
                  pb="nominal", country="USA", note=UNSETTLED),
    "delinq": fed("Charge-Off and Delinquency Rates on Loans and Leases at Commercial Banks", None,
                  "https://www.federalreserve.gov/releases/chargeoff/", sa="sa", pb="not_applicable",
                  country="USA", note=UNSETTLED),
    "hy_spread": none("ICE Data Indices", "ICE BofA US High Yield Index Option-Adjusted Spread",
                      "H0A0", "rights_restriction",
                      "The index is licensed by ICE; v1's channel carried only three years of it "
                      "for that reason.", sa="not_applicable", pb="not_applicable", country="USA", refresh="none"),
    "sofr": src(NY_FED, "Secured Overnight Financing Rate", "SOFR",
                "https://www.newyorkfed.org/markets/reference-rates/sofr", sa="not_applicable",
                pb="nominal", country="USA"),
    "ted": none("No single Origin (v1 used a spread the Federal Reserve Bank of St. Louis computed)",
                "TED spread: three-month LIBOR less the three-month Treasury bill", "TEDRATE",
                "discontinued", "FRED stopped computing it in January 2022, when its LIBOR input was withdrawn.",
                sa="not_applicable", pb="not_applicable", country="USA", refresh="none", status="retired"),
    # --- housing ---
    "houst": src(CENSUS, "New Residential Construction", None,
                 "https://www.census.gov/construction/nrc/", sa="saar", pb="not_applicable",
                 country="USA", milestone="M16", unit="thousands of housing units, annual rate", note=UNSETTLED),
    "caseshiller": none("S&P Dow Jones Indices (S&P CoreLogic Case-Shiller)",
                        "S&P CoreLogic Case-Shiller U.S. National Home Price Index", "CSUSHPINSA",
                        "no_route_established",
                        "A proprietary index whose terms have not been read. The Federal Housing "
                        "Finance Agency's house price index is a different quantity and would "
                        "take a new key.", sa="nsa", pb="nominal", country="USA", refresh="none"),
    "medhome": src(CENSUS, "New Residential Sales", None, "https://www.census.gov/construction/nrs/",
                   sa="nsa", pb="nominal", country="USA", milestone="M16",
                   description="Median sales price of new houses sold.", note=UNSETTLED),
    "rent_cpi": bls("Consumer Price Index", "CUSR0000SEHA", sa="sa", pb="not_applicable", country="USA",
                    unit="index, 1982-84 = 100", base="1982-84"),
    # --- politics and sentiment ---
    "umcsent": none(UMICH, "Index of Consumer Sentiment", "ICS", "no_route_established",
                    "The survey is the University's own and its terms have not been read; v1's "
                    "channel showed it by permission.", sa="nsa", pb="not_applicable", country="USA",
                    refresh="none", base="1966-Q1", unit="index, 1966 Q1 = 100"),
    "usepu": src(EPU, "US Monthly Economic Policy Uncertainty Index", None,
                 "https://www.policyuncertainty.com/us_monthly.html", sa="not_applicable",
                 pb="not_applicable", country="USA", note=UNSETTLED),
    "gepu": src(EPU, "Global Economic Policy Uncertainty Index", None,
                "https://www.policyuncertainty.com/global_monthly.html", sa="not_applicable",
                pb="not_applicable", country="WLD", note=UNSETTLED),
    "euepu": src(EPU, "European Economic Policy Uncertainty Index", None,
                 "https://www.policyuncertainty.com/europe_monthly.html", sa="not_applicable",
                 pb="not_applicable", country="EU", note=UNSETTLED),
    # --- Europe ---
    "ez_unemp": eurostat("une_rt_m (Unemployment by sex and age, monthly)", "M.SA.TOTAL.PC_ACT.T.EA21",
                         "EA", sa="sa", pb="not_applicable",
                         geography="Euro area, changing composition (v1's own choice)."),
    "ez_hicp": eurostat("prc_hicp_midx (Harmonised index of consumer prices, monthly)", None, "EA",
                        sa="nsa", pb="not_applicable", unit="index, 2015 = 100", base="2015",
                        geography="Euro area of 19 countries, as v1 showed it.",
                        note=UNSETTLED + " v1's series was the fixed 19-country aggregate; the adapter "
                             "must name that composition or the change is a different quantity."),
    "ecb": src(ECB, "Key ECB interest rates: deposit facility", "FM.D.U2.EUR.4F.KR.DFR.LEV",
               "https://data.ecb.europa.eu/", sa="not_applicable", pb="nominal", country="EA"),
    "ez_gdp": eurostat("namq_10_gdp (Gross domestic product and main components, quarterly)", None, "EA",
                       sa="sa", pb="real", agg="sum",
                       geography="Euro area of 19 countries, as v1 showed it.",
                       note=UNSETTLED + " v1's series was chain-linked volumes for the fixed "
                            "19-country aggregate; the adapter must name the composition and the "
                            "reference year."),
    "eurusd": h10("RXI$US_N.B.EU", "EA"),
    "gbpusd": h10("RXI$US_N.B.UK", "GBR"),
    "uk_unemp": src(ONS, "Labour market statistics", "MGSX",
                    "https://www.ons.gov.uk/employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms",
                    sa="sa", pb="not_applicable", country="GBR", milestone="v2.2"),
    "uk_cpi": src(ONS, "Consumer price inflation (MM23)", "D7BT",
                  "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23",
                  sa="nsa", pb="not_applicable", country="GBR", milestone="M14"),
    "boe": oecd("Monthly financial statistics: immediate interbank rate", "GBR", note=INTERBANK,
                sa="not_applicable", pb="nominal"),
    "de_unemp": eurostat("une_rt_m (Unemployment by sex and age, monthly)", "M.SA.TOTAL.PC_ACT.T.DE",
                         "DEU", sa="sa", pb="not_applicable"),
    "fr_unemp": eurostat("une_rt_m (Unemployment by sex and age, monthly)", "M.SA.TOTAL.PC_ACT.T.FR",
                         "FRA", sa="sa", pb="not_applicable"),
    "de10": eurostat("irt_lt_mcby_m (Maastricht criterion bond yields, monthly)", "M.MCBY.DE", "DEU",
                     sa="not_applicable", pb="nominal"),
    "it10": eurostat("irt_lt_mcby_m (Maastricht criterion bond yields, monthly)", "M.MCBY.IT", "ITA",
                     sa="not_applicable", pb="nominal"),
    "ecb_assets": src(ECB, "Weekly financial statement of the Eurosystem: total assets", None,
                      "https://data.ecb.europa.eu/", sa="not_applicable", pb="nominal", country="EA",
                      note=UNSETTLED),
    # --- Asia and other ---
    "jp_unemp": oecd("Infra-annual labour statistics: monthly unemployment rate", "JPN"),
    "ca_unemp": oecd("Infra-annual labour statistics: monthly unemployment rate", "CAN"),
    "kr_unemp": oecd("Infra-annual labour statistics: monthly unemployment rate", "KOR"),
    "jp10": oecd("Monthly financial statistics: long-term interest rate", "JPN",
                 sa="not_applicable", pb="nominal"),
    "jp_cpi": src(IMF, "Consumer Price Index", None, "https://data.imf.org/", sa="nsa",
                  pb="not_applicable", country="JPN", milestone="M14", change="representation",
                  note="v1's series ends in June 2021. The IMF carries the national all-items "
                       "index to date (research 02 matched it to e-Stat for 25 months); its base "
                       "period may differ from v1's. " + UNSETTLED),
    "cn_cpi": src(IMF, "Consumer Price Index", None, "https://data.imf.org/", sa="nsa",
                  pb="not_applicable", country="CHN", milestone="M14", change="representation",
                  note="The national all-items index; its base period may differ from v1's. " + UNSETTLED),
    "cn_gdp": world_bank("NY.GDP.MKTP.CD", "CHN", pb="nominal", agg="sum", unit="current U.S. dollars"),
    "jp_rate": oecd("Monthly financial statistics: immediate interbank rate", "JPN", note=INTERBANK,
                    sa="not_applicable", pb="nominal"),
    "br_rate": oecd("Monthly financial statistics: immediate interbank rate", "BRA", note=INTERBANK,
                    sa="not_applicable", pb="nominal"),
    "mx_rate": oecd("Monthly financial statistics: immediate interbank rate", "MEX", note=INTERBANK,
                    sa="not_applicable", pb="nominal"),
    "tr_rate": oecd("Monthly financial statistics: immediate interbank rate", "TUR", note=INTERBANK,
                    sa="not_applicable", pb="nominal"),
    # --- currencies ---
    "jpy": h10("RXI_N.B.JA", "JPN", unit="Japanese yen per U.S. dollar"),
    "cny": h10("RXI_N.B.CH", "CHN", unit="Chinese yuan per U.S. dollar"),
    "inr": h10("RXI_N.B.IN", "IND"),
    "cad": h10("RXI_N.B.CA", "CAN"),
    "brl": h10("RXI_N.B.BZ", "BRA"),
    "mxn": h10("RXI_N.B.MX", "MEX"),
    "tryusd": src(IMF, "Exchange Rates", None, "https://data.imf.org/", sa="not_applicable", pb="nominal",
                  country="TUR", milestone="M14", note="Monthly average, as v1 showed. " + UNSETTLED),
    "usd_broad": h10("JRXWTFB_N.B", "USA"),
}
for _key in ("eurusd", "gbpusd", "jpy", "cny", "inr", "cad", "brl", "mxn", "usd_broad"):
    PROPOSALS[_key].setdefault("note", "The identifier is the Data Download Program's as recalled, "
                                       "to be confirmed by M13's captured fixture.")
for _key in ("fedfunds",):
    PROPOSALS[_key]["note"] = ("The identifier is the Data Download Program's as recalled, to be "
                               "confirmed by M13's captured fixture.")

# The four Series M7 and M8 bound to the BLS endpoint, exactly as the series table declared
# them: their recorded name and unit are metadata history and are not reworded here.
BUILT = {
    "cpi": ("Consumer Price Index for All Urban Consumers: all items, U.S. city average, seasonally adjusted",
            "index, 1982-84 = 100", [100, 600]),
    "cpi_nsa": ("Consumer Price Index for All Urban Consumers: all items, U.S. city average, not seasonally adjusted",
                "index, 1982-84 = 100", [100, 600]),
    "unrate": ("Unemployment rate, 16 years and over, seasonally adjusted", "percent", [0, 30]),
    "payems": ("All employees, total nonfarm, seasonally adjusted", "thousands of persons", [50000, 300000]),
}
BLS_ENDPOINT = {"via": "direct", "adapter": "bls", "endpoint": "bls-headline", "auth": "none"}


def v1_label(entry: dict) -> str:
    if entry["source"] == "fred":
        return f"FRED {entry['id']}"
    if entry["source"] == "yahoo":
        return f"Yahoo {entry['id']}"
    if entry["source"] == "csv_url":
        return f"{entry['csv']['src_name']} {entry['id']}"
    return f"Computed: {entry['id']}"


def ordered(entry: dict) -> dict:
    schema = json.loads((ROOT / "schema" / "series.schema.json").read_text())
    order = list(schema["properties"])
    return {name: entry[name] for name in order if name in entry}


def stored_entry(v1: dict) -> dict:
    key, p = v1["key"], dict(PROPOSALS[v1["key"]])
    unit = p.get("unit") or UNIT_WORDS[v1["unit"]]
    measure_kind = _measure_kind(key, v1["unit"])
    freq = p.get("freq") or FREQ[v1["freq"]]
    agg = p.get("agg") or v1["agg"]
    description = p.get("description") or (v1.get("note") or None)
    entry = {
        "key": key, "name": v1["name"], "unit": unit, "unit_kind": _unit_kind(v1["unit"]),
        "measure_kind": measure_kind, "agg": agg, "freq": freq, "continuity": "discrete",
        "seasonal_adjustment": p["sa"], "price_basis": p["pb"], "country": p["country"],
        "segment": SEGMENT_OF_CATEGORY[v1["cat"]], "topics": [_slug(v1["cat"])],
        "refresh": p.get("refresh") or REFRESH[v1["freq"]],
        "max_lag": f"P{int(v1['max_lag_months'])}M", "status": p.get("status", "draft"),
    }
    if description:
        entry["description"] = description.rstrip(".") + "."
    if p.get("geography"):
        entry["definition"] = {"geography": p["geography"]}
    base = p.get("base") or BASE.get(v1["unit"])
    if base:
        entry["base_period"] = base
    if v1.get("range"):
        entry["range"] = [float(v1["range"][0]), float(v1["range"][1])]
    origin = {"producer": p["producer"], "dataset": p["dataset"], "origin_id": p["origin_id"], "url": p["url"]}
    if "no_channel" in p:
        entry["source"] = {"origin": origin, "channel": None, "no_channel": p["no_channel"]}
    else:
        entry["source"] = {"origin": origin, "channel": {"via": p.get("via", "direct")}}
    migration = {"v1_source": v1_label(v1), "change": p.get("change", "same")}
    if p.get("note"):
        migration["note"] = p["note"]
    if p.get("milestone"):
        migration["milestone"] = p["milestone"]
    entry["migration"] = migration
    if key in BUILT:
        name, unit, bounds = BUILT[key]
        entry.update(name=name, unit=unit, range=bounds, status="active", max_lag="P3M")
        entry["source"]["channel"] = dict(BLS_ENDPOINT)
        entry.pop("description", None)
    return ordered(entry)


def yoy_entry(parent_v1: dict, parent: dict) -> dict:
    key = parent_v1["yoy_key"]
    freq = parent["freq"]
    entry = {
        "key": key, "name": parent_v1["yoy_name"], "unit": "percent change from a year earlier",
        "unit_kind": "percent", "measure_kind": "rate", "agg": "none", "freq": freq,
        "continuity": "discrete", "seasonal_adjustment": parent["seasonal_adjustment"],
        "price_basis": parent["price_basis"], "country": parent["country"],
        "segment": parent["segment"], "topics": parent["topics"], "refresh": parent["refresh"],
        "max_lag": parent["max_lag"], "status": "draft",
        "recipe": {"op": "pct_change", "inputs": [parent["key"]], "order": "aggregate_then_compute",
                   "params": {"lag": PER_YEAR[freq]}},
        "migration": {"v1_source": f"Computed: {parent['key']} y/y", "change": "same"},
    }
    if parent_v1.get("yoy_range"):
        entry["range"] = [float(parent_v1["yoy_range"][0]), float(parent_v1["yoy_range"][1])]
    return ordered(entry)


def entries() -> dict[str, dict]:
    catalog = yaml.safe_load((ROOT / "atlas" / "catalog.yaml").read_text())
    out: dict[str, dict] = {}
    by_key = {e["key"]: e for e in catalog}
    for v1 in catalog:
        if v1["source"] != "derived" and v1["key"] != "t10y2y":
            out[v1["key"]] = stored_entry(v1)
    for v1 in catalog:
        if v1.get("derive_yoy"):
            out[v1["yoy_key"]] = yoy_entry(v1, out[v1["key"]])

    # cpi_nsa: added in M8 for the headline twelve-month change; never a v1 series.
    nsa = dict(out["cpi"])
    nsa.update(key="cpi_nsa", name=BUILT["cpi_nsa"][0], seasonal_adjustment="nsa")
    nsa["source"] = {"origin": {**out["cpi"]["source"]["origin"], "origin_id": "CUUR0000SA0",
                                "url": "https://data.bls.gov/timeseries/CUUR0000SA0"},
                     "channel": dict(BLS_ENDPOINT)}
    del nsa["migration"]
    out["cpi_nsa"] = ordered(nsa)
    # cpi_yoy: the twelve-month change of the unadjusted index, as BLS publishes it (ADR 0025,
    # decision 2; open with Alex). v1 computed it from the adjusted index.
    yoy = dict(out["cpi_yoy"])
    yoy.update(name="Consumer Price Index for All Urban Consumers: all items, change from a year "
                    "earlier, not seasonally adjusted", seasonal_adjustment="nsa", status="active",
               max_lag="P3M", range=[-20, 25])
    yoy["recipe"] = {**yoy["recipe"], "inputs": ["cpi_nsa"]}
    yoy["migration"] = {"v1_source": "Computed: cpi y/y", "change": "different",
                        "note": "v1 computed this from the seasonally adjusted index. Here it is the "
                                "twelve-month change of the unadjusted index, the figure BLS "
                                "publishes as the headline (ADR 0025, decision 2; open with Alex)."}
    out["cpi_yoy"] = ordered(yoy)

    # v1's ratio: month-end gold over the monthly average of EUR/USD.
    gold_eur = by_key["gold_eur"]
    out["gold_eur"] = ordered({
        "key": "gold_eur", "name": gold_eur["name"], "unit": UNIT_WORDS["€/oz"], "unit_kind": "currency",
        "measure_kind": "rate", "agg": "none", "freq": "monthly", "continuity": "discrete",
        "description": gold_eur["note"] + ".",
        "seasonal_adjustment": "not_applicable", "price_basis": "nominal", "country": "WLD",
        "segment": SEGMENT_OF_CATEGORY[gold_eur["cat"]], "topics": [_slug(gold_eur["cat"])],
        "refresh": "none", "max_lag": f"P{int(gold_eur['max_lag_months'])}M", "status": "draft",
        "recipe": {"op": "ratio", "inputs": list(gold_eur["derive"]["div"]), "order": "aggregate_then_compute"},
        "migration": {"v1_source": v1_label(gold_eur), "change": "same"},
    })
    # The yield curve: v1 took FRED's own computed spread. The Board publishes both yields.
    v1 = by_key["t10y2y"]
    spread = {
        "key": "t10y2y", "name": v1["name"], "unit": "percentage points", "unit_kind": "percentage_points",
        "measure_kind": "rate", "agg": "mean", "freq": "business_daily", "continuity": "discrete",
        "description": "Negative = inverted.", "seasonal_adjustment": "not_applicable",
        "price_basis": "nominal", "country": "USA", "segment": SEGMENT_OF_CATEGORY[v1["cat"]],
        "topics": [_slug(v1["cat"])], "refresh": "daily", "max_lag": "P1M",
        "range": [float(v1["range"][0]), float(v1["range"][1])], "status": "draft",
        "recipe": {"op": "difference", "inputs": ["gs10", "gs2"], "order": "aggregate_then_compute"},
        "migration": {"v1_source": v1_label(v1), "change": "same",
                      "note": "v1 took the spread FRED computes. Here it is the same difference, "
                              "computed by the engine from the two yields the Board publishes."},
    }
    out["t10y2y"] = ordered(spread)

    # v1's three hand-entered series (atlas/approval.yaml, atlas/politics.yaml).
    politics = {"segment": "governance_politics", "topics": ["politics-sentiment"], "country": "USA",
                "seasonal_adjustment": "not_applicable", "price_basis": "not_applicable", "status": "draft"}
    out["approval"] = ordered({
        "key": "approval", "name": "Presidential approval (Gallup, approx.)", "unit": "percent",
        "unit_kind": "percent", "measure_kind": "rate", "agg": "mean", "freq": "quarterly",
        "continuity": "discrete", "description": "Approximate quarterly averages, entered by hand.",
        "refresh": "quarterly", **politics,
        "source": {"origin": {"producer": GALLUP, "dataset": "Presidential approval, quarterly averages",
                              "origin_id": None, "url": None}, "channel": {"via": "hand_entered"}},
        "migration": {"v1_source": "Hand-entered: atlas/approval.yaml", "change": "same", "milestone": "M16",
                      "note": "The register proposes no display for Gallup's figures: read its "
                              "terms, or choose a source with clear terms, before M16."},
    })
    for key, name, chamber in (("pres_margin", "Presidential popular vote margin (D−R)", "president"),
                               ("house_margin", "House popular vote margin (D−R)", "House of Representatives")):
        out[key] = ordered({
            "key": key, "name": name, "unit": "percentage points", "unit_kind": "percentage_points",
            "measure_kind": "rate", "agg": "none", "freq": "irregular", "continuity": "held",
            "description": "Two-party share, Democratic minus Republican; positive means "
                           "Democratic. Each result stands until the next election.",
            "refresh": "irregular", **politics,
            "source": {"origin": {"producer": FEC, "dataset": f"Federal Elections: official results for {chamber}",
                                  "origin_id": None, "url": "https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/"},
                       "channel": {"via": "hand_entered"}},
            "migration": {"v1_source": "Hand-entered: atlas/politics.yaml (Wikipedia election infoboxes)",
                          "change": "same", "milestone": "M16",
                          "note": "v1's votes were read from Wikipedia. The register's Wikipedia row "
                                  "says to enter them from the official record instead, each with "
                                  "its citation; that record needs a row of its own."},
        })
    for key, entry in out.items():
        entry_key_order = list(entry)
        assert entry_key_order[0] == "key" and entry["key"] == key
    return dict(sorted(out.items()))


def dump(entry: dict) -> str:
    return json.dumps(entry, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    wanted = {key: dump(entry) for key, entry in entries().items()}
    changed = [key for key, text in wanted.items()
               if not (OUT / f"{key}.json").exists() or (OUT / f"{key}.json").read_text() != text]
    if check:
        for key in changed:
            print(f"would write catalog/series/{key}.json")
        print(f"{len(wanted)} Series; {len(changed)} differ from what the migration writes")
        return 1 if changed else 0
    OUT.mkdir(parents=True, exist_ok=True)
    for key in changed:
        (OUT / f"{key}.json").write_text(wanted[key])
    print(f"wrote {len(changed)} of {len(wanted)} Series files under catalog/series")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
