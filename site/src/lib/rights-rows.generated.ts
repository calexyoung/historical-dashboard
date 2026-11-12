// GENERATED from schema/rights-register.json by scripts/gen-rights.mjs. Do not edit.
// The rows /docs/rights lists. The gate reads packages/core/src/rights-register.generated.ts, not this.

export type RightsRow = {
  id: string;
  kind: "origin" | "channel";
  name: string;
  licence_class: string;
  attribution: string | null;
  terms: { url: string; read_on: string | null; how: string }[];
  proposal: { display: boolean; redistribute: boolean; store: boolean; ml_use: boolean };
  decision: { display: boolean; redistribute: boolean; store: boolean; ml_use: boolean; signed_on: string } | null;
};

export const RIGHTS_ROWS: { version: string; cleared: string[]; rows: RightsRow[] } = {
 "version": "2026-11-12.4",
 "cleared": [],
 "rows": [
  {
   "id": "bls",
   "kind": "origin",
   "name": "Bureau of Labor Statistics",
   "licence_class": "public_domain",
   "attribution": "Source: U.S. Bureau of Labor Statistics.",
   "terms": [
    {
     "url": "https://www.bls.gov/bls/linksite.htm",
     "read_on": "2026-11-11",
     "how": "extract"
    },
    {
     "url": "https://www.bls.gov/developers/termsOfService.htm",
     "read_on": "2026-11-12",
     "how": "attested"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "bea",
   "kind": "origin",
   "name": "Bureau of Economic Analysis",
   "licence_class": "public_domain",
   "attribution": "Source: U.S. Bureau of Economic Analysis.",
   "terms": [
    {
     "url": "https://www.bea.gov/help/guidelines-for-citing-bea",
     "read_on": "2026-11-11",
     "how": "page"
    },
    {
     "url": "https://apps.bea.gov/API/signup/",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "census",
   "kind": "origin",
   "name": "Census Bureau",
   "licence_class": "public_domain",
   "attribution": "Source: U.S. Census Bureau.",
   "terms": [
    {
     "url": "https://www.census.gov/data/developers/about/terms-of-service.html",
     "read_on": "2026-11-11",
     "how": "page"
    },
    {
     "url": "https://www.census.gov/about/policies/citation.html",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "treasury-fiscal-data",
   "kind": "origin",
   "name": "Treasury Fiscal Data",
   "licence_class": "public_domain",
   "attribution": "Source: U.S. Department of the Treasury, Fiscal Data.",
   "terms": [
    {
     "url": "https://fiscaldata.treasury.gov/api-documentation/",
     "read_on": "2026-11-11",
     "how": "page"
    },
    {
     "url": "https://fiscaldata.treasury.gov/about-us/",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "fed-board",
   "kind": "origin",
   "name": "Federal Reserve Board",
   "licence_class": "public_domain",
   "attribution": "Source: Board of Governors of the Federal Reserve System.",
   "terms": [
    {
     "url": "https://www.federalreserve.gov/disclaimer.htm",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "eia",
   "kind": "origin",
   "name": "Energy Information Administration",
   "licence_class": "public_domain",
   "attribution": "Source: U.S. Energy Information Administration (with the publication date).",
   "terms": [
    {
     "url": "https://www.eia.gov/about/copyrights_reuse.php",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true,
    "signed_on": "2026-11-12"
   }
  },
  {
   "id": "eia-spot-prices",
   "kind": "origin",
   "name": "Energy Information Administration: spot prices credited to a commercial provider",
   "licence_class": "unknown",
   "attribution": "Source: U.S. Energy Information Administration (with the publication date).",
   "terms": [
    {
     "url": "https://www.eia.gov/about/copyrights_reuse.php",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "fred",
   "kind": "channel",
   "name": "FRED (Federal Reserve Bank of St. Louis), as a channel",
   "licence_class": "permission_required",
   "attribution": null,
   "terms": [
    {
     "url": "https://fred.stlouisfed.org/legal/",
     "read_on": "2026-11-11",
     "how": "extract"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "alfred",
   "kind": "channel",
   "name": "ALFRED (Federal Reserve Bank of St. Louis), as a channel",
   "licence_class": "unknown",
   "attribution": null,
   "terms": [
    {
     "url": "https://alfred.stlouisfed.org/legal/",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "yahoo",
   "kind": "channel",
   "name": "Yahoo Finance, as a channel",
   "licence_class": "permission_required",
   "attribution": null,
   "terms": [
    {
     "url": "https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "philadelphia-fed",
   "kind": "origin",
   "name": "Federal Reserve Bank of Philadelphia, Real-Time Data Set",
   "licence_class": "unknown",
   "attribution": null,
   "terms": [
    {
     "url": "https://www.philadelphiafed.org/",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "imf",
   "kind": "origin",
   "name": "International Monetary Fund",
   "licence_class": "citation_required",
   "attribution": "Source: International Monetary Fund.",
   "terms": [
    {
     "url": "https://www.imf.org/en/About/copyright-and-terms",
     "read_on": "2026-11-11",
     "how": "extract"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "oecd",
   "kind": "origin",
   "name": "OECD",
   "licence_class": "unknown",
   "attribution": "Source: OECD.",
   "terms": [
    {
     "url": "https://www.oecd.org/en/about/terms-conditions.html",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "world-bank",
   "kind": "origin",
   "name": "World Bank",
   "licence_class": "cc_by",
   "attribution": "Source: World Bank (CC BY 4.0), with the indicator name and code.",
   "terms": [
    {
     "url": "https://datacatalog.worldbank.org/public-licenses",
     "read_on": "2026-11-11",
     "how": "extract"
    },
    {
     "url": "https://www.worldbank.org/ext/en/legal/terms-conditions",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "bis",
   "kind": "origin",
   "name": "Bank for International Settlements",
   "licence_class": "citation_required",
   "attribution": "Source: Bank for International Settlements.",
   "terms": [
    {
     "url": "https://data.bis.org/help/legal",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "eurostat",
   "kind": "origin",
   "name": "Eurostat",
   "licence_class": "citation_required",
   "attribution": "Source: Eurostat.",
   "terms": [
    {
     "url": "https://ec.europa.eu/eurostat/web/main/help/copyright-notice",
     "read_on": "2026-11-11",
     "how": "extract"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "e-stat",
   "kind": "origin",
   "name": "e-Stat, Portal Site of Official Statistics of Japan",
   "licence_class": "citation_required",
   "attribution": "Source: Portal Site of Official Statistics of Japan (https://www.e-stat.go.jp/), Consumer Price Index (Statistics Bureau of Japan).",
   "terms": [
    {
     "url": "https://www.e-stat.go.jp/en/terms-of-use",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "bts",
   "kind": "origin",
   "name": "Bureau of Transportation Statistics",
   "licence_class": "unknown",
   "attribution": "Source: U.S. Bureau of Transportation Statistics.",
   "terms": [
    {
     "url": "https://www.bts.gov/copyright",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "usaspending",
   "kind": "origin",
   "name": "USAspending",
   "licence_class": "public_domain",
   "attribution": "Source: USAspending.gov.",
   "terms": [
    {
     "url": "https://api.usaspending.gov/",
     "read_on": "2026-11-11",
     "how": "page"
    },
    {
     "url": "https://www.usaspending.gov/about",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "openfema",
   "kind": "origin",
   "name": "OpenFEMA",
   "licence_class": "citation_required",
   "attribution": "This product uses the Federal Emergency Management Agency's OpenFEMA API, but is not endorsed by FEMA. (With the endpoint, its version and the date retrieved.)",
   "terms": [
    {
     "url": "https://www.fema.gov/about/openfema/terms-conditions",
     "read_on": "2026-11-11",
     "how": "extract"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "cdc-nchs",
   "kind": "origin",
   "name": "CDC, National Center for Health Statistics",
   "licence_class": "public_domain",
   "attribution": "Source: Centers for Disease Control and Prevention, National Center for Health Statistics.",
   "terms": [
    {
     "url": "https://www.cdc.gov/other/agencymaterials.html",
     "read_on": "2026-11-11",
     "how": "extract"
    },
    {
     "url": "https://www.cdc.gov/nchs/policy/data-user-agreement.html",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "noaa-ncei",
   "kind": "origin",
   "name": "NOAA National Centers for Environmental Information",
   "licence_class": "public_domain",
   "attribution": "NOAA National Centers for Environmental Information (NCEI) U.S. Billion-Dollar Weather and Climate Disasters, DOI: 10.25921/stkw-7w73.",
   "terms": [
    {
     "url": "https://www.ncei.noaa.gov/access/billions/",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "owid",
   "kind": "origin",
   "name": "Our World in Data",
   "licence_class": "cc_by",
   "attribution": "Source: Our World in Data (CC BY), with the upstream provider named.",
   "terms": [
    {
     "url": "https://ourworldindata.org/faqs",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "em-dat",
   "kind": "origin",
   "name": "EM-DAT (CRED, UCLouvain)",
   "licence_class": "no_redistribution",
   "attribution": null,
   "terms": [
    {
     "url": "https://doc.emdat.be/docs/legal/terms-of-use/",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "ntia",
   "kind": "origin",
   "name": "NTIA Internet Use Survey",
   "licence_class": "public_domain",
   "attribution": "Source: NTIA Internet Use Survey.",
   "terms": [
    {
     "url": "https://www.ntia.gov/data/explorer",
     "read_on": "2026-11-11",
     "how": "extract"
    },
    {
     "url": "https://www.ntia.gov/page/web-policies",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "national-statistics-offices",
   "kind": "origin",
   "name": "National statistics offices (placeholder)",
   "licence_class": "unknown",
   "attribution": null,
   "terms": [],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "gallup",
   "kind": "origin",
   "name": "Gallup (hand-entered presidential approval)",
   "licence_class": "unknown",
   "attribution": null,
   "terms": [
    {
     "url": "https://www.gallup.com/",
     "read_on": null,
     "how": "not_read"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "wikipedia",
   "kind": "origin",
   "name": "Wikipedia (hand-entered election results)",
   "licence_class": "citation_required",
   "attribution": "Source: Wikipedia, with the article and the date read (CC BY-SA 4.0).",
   "terms": [
    {
     "url": "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": false,
    "redistribute": false,
    "store": false,
    "ml_use": false
   },
   "decision": null
  },
  {
   "id": "fec",
   "kind": "origin",
   "name": "Federal Election Commission (hand-entered election results)",
   "licence_class": "public_domain",
   "attribution": "Source: Federal Election Commission, Federal Elections (the edition and page cited with each figure).",
   "terms": [
    {
     "url": "https://www.fec.gov/introduction-campaign-finance/election-results-and-voting-information/",
     "read_on": "2026-11-11",
     "how": "page"
    },
    {
     "url": "https://www.fec.gov/about/privacy-and-security-policy/",
     "read_on": "2026-11-11",
     "how": "page"
    }
   ],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "public-record",
   "kind": "origin",
   "name": "Hand-entered facts from the public record",
   "licence_class": "public_domain",
   "attribution": "Each entry carries its own citation.",
   "terms": [],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "macro-atlas-computed",
   "kind": "origin",
   "name": "Macro Atlas, computed series",
   "licence_class": "public_domain",
   "attribution": "Computed by Macro Atlas from the sources named.",
   "terms": [],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  },
  {
   "id": "macro-atlas-fixture",
   "kind": "origin",
   "name": "Macro Atlas, synthetic fixture",
   "licence_class": "public_domain",
   "attribution": "Synthetic data, not a measurement of anything.",
   "terms": [],
   "proposal": {
    "display": true,
    "redistribute": true,
    "store": true,
    "ml_use": true
   },
   "decision": null
  }
 ]
};
