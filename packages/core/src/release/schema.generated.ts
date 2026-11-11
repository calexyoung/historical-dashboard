// GENERATED from schema/release.schema.json by scripts/gen-schema.mjs. Do not edit.

export const SCHEMA_VERSION = "0.1.0";

export const releaseSchema: Record<string, unknown> = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mydashboards.co/macro-atlas/schema/release.schema.json",
  "title": "Release",
  "description": "Macro Atlas release contract, v0 (schema_version 0.1.0). A Release is a directory; this schema describes it gathered into one object: manifest.json, catalog.json, series/{key}.json, derived/{key}.json and content/annotations.json. It is the seam between the writer and every reader (PLAN 4.2). Conventions the schema cannot express, and the cross-file rules, are in schema/README.md. Structural validity is not authorisation: whether a series may appear on a Surface is decided by permits() and the rights register.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "manifest",
    "catalog",
    "series",
    "derived",
    "annotations"
  ],
  "properties": {
    "manifest": {
      "$ref": "#/$defs/manifest"
    },
    "catalog": {
      "$ref": "#/$defs/catalog"
    },
    "series": {
      "description": "series/{key}.json: stored Series at native frequency.",
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/key"
      },
      "additionalProperties": {
        "$ref": "#/$defs/seriesFile"
      }
    },
    "derived": {
      "description": "derived/{key}.json: outputs of Recipes, written by the engine (ADR 0003).",
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/key"
      },
      "additionalProperties": {
        "$ref": "#/$defs/seriesFile"
      }
    },
    "annotations": {
      "$ref": "#/$defs/annotationsFile"
    }
  },
  "$defs": {
    "key": {
      "title": "SeriesKey",
      "description": "A Series' permanent public key. Also a file name, so it is restricted to safe characters.",
      "type": "string",
      "pattern": "^[a-z][a-z0-9_]{0,63}$"
    },
    "date": {
      "title": "CalendarDate",
      "description": "A calendar date, YYYY-MM-DD. No time and no zone.",
      "type": "string",
      "format": "date",
      "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$"
    },
    "datetime": {
      "title": "Instant",
      "description": "An instant in UTC, RFC 3339 with a Z suffix.",
      "type": "string",
      "format": "date-time",
      "pattern": "Z$"
    },
    "sha256": {
      "title": "Sha256",
      "type": "string",
      "pattern": "^[0-9a-f]{64}$"
    },
    "period": {
      "title": "PeriodLabel",
      "description": "The label of a Period: 2024 (annual), 2024-Q1, 2024-01, 2024-W03 (ISO week), 2024-01-15 (a day; also used by irregular series).",
      "type": "string",
      "pattern": "^[0-9]{4}(-Q[1-4]|-W[0-9]{2}|-[0-9]{2}(-[0-9]{2})?)?$"
    },
    "frequency": {
      "title": "Frequency",
      "description": "Native frequency. daily covers every calendar day; business_daily covers Monday to Friday (a holiday is an explicit missing Observation); irregular has no fixed cadence (for example one Observation per election).",
      "enum": [
        "daily",
        "business_daily",
        "weekly",
        "monthly",
        "quarterly",
        "annual",
        "irregular"
      ]
    },
    "representation": {
      "title": "Representation",
      "description": "native: unrounded, at native frequency, from an adapter. legacy_monthly_rounded: carried over from v1's output, already rounded; never in a public Release and never mixed with native values in one Series.",
      "enum": [
        "native",
        "legacy_monthly_rounded"
      ]
    },
    "profile": {
      "title": "Profile",
      "description": "public: built only from what the rights register allows; the only kind production may serve. local: may also hold v1's legacy data, drafts and user notes; never served on a public Surface (PLAN 6.1).",
      "enum": [
        "public",
        "local"
      ]
    },
    "rightsStatus": {
      "title": "RightsStatus",
      "enum": [
        "public_domain",
        "cc_by",
        "citation_required",
        "permission_required",
        "no_redistribution",
        "unknown"
      ]
    },
    "observationStatus": {
      "title": "ObservationStatus",
      "description": "What kind of value an Observation is. missing and suppressed carry no value. projected is never presented as observed.",
      "enum": [
        "final",
        "preliminary",
        "revised",
        "estimate",
        "projected",
        "partial",
        "suppressed",
        "missing"
      ]
    },
    "manifest": {
      "title": "Manifest",
      "description": "manifest.json: what this Release is and what it holds. created is when the Release was written, and is also the fixed date against which staleness (max_lag) is judged, so a Release never changes state as the clock moves.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "schema_version",
        "semantics_version",
        "release_id",
        "profile",
        "created",
        "rights_register",
        "series",
        "withheld",
        "checks"
      ],
      "properties": {
        "schema_version": {
          "description": "Version of this contract. Readers refuse a version they do not know.",
          "const": "0.1.0"
        },
        "semantics_version": {
          "description": "Version of the engine's behaviour that wrote derived/ (ADR 0003).",
          "type": "string",
          "minLength": 1
        },
        "release_id": {
          "description": "UTC time plus a short hash. Equals the directory name.",
          "type": "string",
          "pattern": "^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7,12}$"
        },
        "profile": {
          "$ref": "#/$defs/profile"
        },
        "created": {
          "$ref": "#/$defs/datetime"
        },
        "rights_register": {
          "title": "RightsRegisterRef",
          "description": "The rights register this Release was built against. signed says Alex has signed that version; a public Release requires it. It does not by itself authorise any Series: that is the writer's allowlist and permits().",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "version",
            "sha256",
            "signed"
          ],
          "properties": {
            "version": {
              "type": "string",
              "minLength": 1
            },
            "sha256": {
              "description": "Hash of the register file at that version; null before the register exists (M6).",
              "anyOf": [
                {
                  "$ref": "#/$defs/sha256"
                },
                {
                  "type": "null"
                }
              ]
            },
            "signed": {
              "type": "boolean"
            }
          }
        },
        "series": {
          "description": "One row per file under series/ and derived/.",
          "type": "object",
          "propertyNames": {
            "$ref": "#/$defs/key"
          },
          "additionalProperties": {
            "title": "ManifestSeries",
            "description": "sha256 is the hash of the file's exact bytes.",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "kind",
              "sha256",
              "channel",
              "rights_status",
              "representation"
            ],
            "properties": {
              "kind": {
                "description": "stored: series/{key}.json. derived: derived/{key}.json.",
                "enum": [
                  "stored",
                  "derived"
                ]
              },
              "sha256": {
                "$ref": "#/$defs/sha256"
              },
              "state_hash": {
                "description": "The writer's hash of the full normalized state (PLAN 4.3). Opaque to readers; arrives with the VintageStore.",
                "type": "string",
                "minLength": 1
              },
              "channel": {
                "description": "The Channel actually used (catalog source.channel.via).",
                "type": "string",
                "minLength": 1
              },
              "rights_status": {
                "$ref": "#/$defs/rightsStatus"
              },
              "representation": {
                "$ref": "#/$defs/representation"
              }
            }
          }
        },
        "withheld": {
          "description": "Series in the Catalog that are kept out of this Release, each with the reason. A withheld Series has no file and no manifest row.",
          "type": "array",
          "items": {
            "title": "WithheldSeries",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "key",
              "reason"
            ],
            "properties": {
              "key": {
                "$ref": "#/$defs/key"
              },
              "reason": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        },
        "checks": {
          "title": "CheckReport",
          "description": "The writer's check report for this Release.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "passed",
            "report"
          ],
          "properties": {
            "passed": {
              "type": "boolean"
            },
            "report": {
              "type": "array",
              "items": {
                "title": "CheckResult",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "check",
                  "outcome"
                ],
                "properties": {
                  "check": {
                    "type": "string",
                    "minLength": 1
                  },
                  "outcome": {
                    "enum": [
                      "pass",
                      "warn",
                      "fail"
                    ]
                  },
                  "detail": {
                    "type": "string"
                  }
                }
              }
            }
          }
        },
        "sources": {
          "description": "Per-source freshness. fetched is null when the time is not known (never filled with the conversion time).",
          "type": "array",
          "items": {
            "title": "SourceFreshness",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "producer",
              "via",
              "fetched"
            ],
            "properties": {
              "producer": {
                "type": "string",
                "minLength": 1
              },
              "via": {
                "type": "string",
                "minLength": 1
              },
              "fetched": {
                "anyOf": [
                  {
                    "$ref": "#/$defs/datetime"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "outcome": {
                "enum": [
                  "ok",
                  "failed",
                  "stale"
                ]
              },
              "detail": {
                "type": "string"
              }
            }
          }
        },
        "inputs": {
          "description": "Files this Release was converted from, when it was not built from STORE (the legacy converter, M2). generated is the input's own timestamp, kept apart from created.",
          "type": "array",
          "items": {
            "title": "ReleaseInput",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "path",
              "sha256"
            ],
            "properties": {
              "path": {
                "type": "string",
                "minLength": 1
              },
              "sha256": {
                "$ref": "#/$defs/sha256"
              },
              "commit": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "generated": {
                "anyOf": [
                  {
                    "$ref": "#/$defs/datetime"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "note": {
                "type": "string"
              }
            }
          }
        },
        "reused_data_from": {
          "description": "The release whose data files a content-only Release reuses (PLAN 4.4).",
          "type": "string"
        }
      }
    },
    "origin": {
      "title": "Origin",
      "description": "The organisation that produces a Series and the dataset and identifier it publishes it under.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "producer",
        "dataset",
        "origin_id",
        "url"
      ],
      "properties": {
        "producer": {
          "type": "string",
          "minLength": 1
        },
        "dataset": {
          "type": "string",
          "minLength": 1
        },
        "origin_id": {
          "type": [
            "string",
            "null"
          ]
        },
        "url": {
          "type": [
            "string",
            "null"
          ]
        }
      }
    },
    "channel": {
      "title": "Channel",
      "description": "The route by which Macro Atlas actually obtained the values: \"direct\" from the Origin, or an intermediary such as \"fred\". A Channel has terms of its own.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "via"
      ],
      "properties": {
        "via": {
          "type": "string",
          "minLength": 1
        },
        "adapter": {
          "type": "string"
        },
        "endpoint": {
          "type": "string"
        },
        "auth": {
          "enum": [
            "none",
            "api_key"
          ]
        }
      }
    },
    "source": {
      "title": "Source",
      "description": "Origin and Channel, never merged.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "origin",
        "channel"
      ],
      "properties": {
        "origin": {
          "$ref": "#/$defs/origin"
        },
        "channel": {
          "$ref": "#/$defs/channel"
        }
      }
    },
    "rights": {
      "title": "Rights",
      "description": "What the Origin's and Channel's terms were read to allow. The three Permissions are derived from this and the Channel, never typed in.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "owner",
        "terms_url",
        "status",
        "attribution",
        "reviewed"
      ],
      "properties": {
        "owner": {
          "type": "string",
          "minLength": 1
        },
        "terms_url": {
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "$ref": "#/$defs/rightsStatus"
        },
        "attribution": {
          "type": [
            "string",
            "null"
          ]
        },
        "reviewed": {
          "description": "The date the terms were read; null when they have not been.",
          "anyOf": [
            {
              "$ref": "#/$defs/date"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "recipe": {
      "title": "Recipe",
      "description": "The declared rule that produces a Derived series. inputs are ordered: ratio is inputs[0] / inputs[1], difference is inputs[0] - inputs[1]; sum and product take two or more; pct_change takes one input and params.lag (in periods of the input). The output's unit is the entry's own unit. Only the engine in packages/core computes a Recipe (ADR 0003); other code may only check its structure.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "op",
        "inputs"
      ],
      "properties": {
        "op": {
          "enum": [
            "ratio",
            "difference",
            "sum",
            "product",
            "pct_change"
          ]
        },
        "inputs": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/key"
          }
        },
        "params": {
          "type": "object",
          "additionalProperties": {
            "type": [
              "number",
              "string",
              "boolean"
            ]
          }
        },
        "order": {
          "description": "Whether inputs are brought to the output frequency before or after the arithmetic.",
          "enum": [
            "aggregate_then_compute",
            "compute_then_aggregate"
          ]
        }
      }
    },
    "catalogEntry": {
      "title": "CatalogEntry",
      "description": "A minimal Catalog entry (PLAN 5). Optional fields are typed slots: absent means not recorded, never a default.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "name",
        "unit",
        "measure_kind",
        "freq",
        "continuity",
        "representation",
        "segment",
        "source",
        "rights",
        "status"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/key"
        },
        "aliases": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "name": {
          "type": "string",
          "minLength": 1
        },
        "description": {
          "type": "string"
        },
        "definition": {
          "title": "SeriesDefinition",
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "population": {
              "type": "string"
            },
            "geography": {
              "type": "string"
            },
            "denominator": {
              "type": "string"
            }
          }
        },
        "unit": {
          "description": "The unit in words, as shown to a reader.",
          "type": "string",
          "minLength": 1
        },
        "unit_kind": {
          "enum": [
            "percent",
            "percentage_points",
            "index",
            "currency",
            "count",
            "ratio",
            "physical",
            "other"
          ]
        },
        "measure_kind": {
          "description": "Decides how values may be combined across Periods.",
          "enum": [
            "stock",
            "flow",
            "rate",
            "index",
            "annualized"
          ]
        },
        "agg": {
          "description": "How finer Periods combine into a coarser one. Declared, never inferred from measure_kind (PLAN 4.5).",
          "enum": [
            "mean",
            "last",
            "sum",
            "none"
          ]
        },
        "freq": {
          "$ref": "#/$defs/frequency"
        },
        "continuity": {
          "description": "discrete: each Observation describes its own Period only. held: a value stands from its Period until the next Observation (drawn as a step); a missing Observation ends the hold, and the last value stands until the Release's created date.",
          "enum": [
            "discrete",
            "held"
          ]
        },
        "representation": {
          "$ref": "#/$defs/representation"
        },
        "seasonal_adjustment": {
          "enum": [
            "sa",
            "nsa",
            "saar",
            "not_applicable"
          ]
        },
        "price_basis": {
          "enum": [
            "nominal",
            "real",
            "not_applicable"
          ]
        },
        "base_period": {
          "type": "string"
        },
        "allowed_transforms": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "country": {
          "description": "ISO 3166-1 alpha-3, or a group code such as G20.",
          "type": "string"
        },
        "segment": {
          "enum": [
            "economy_jobs",
            "markets_money",
            "infrastructure",
            "governance_politics",
            "disasters_health",
            "us_in_the_world"
          ]
        },
        "topics": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "source": {
          "$ref": "#/$defs/source"
        },
        "rights": {
          "$ref": "#/$defs/rights"
        },
        "status": {
          "enum": [
            "draft",
            "active",
            "retired"
          ]
        },
        "max_lag": {
          "description": "How far the last Observation's period_end may trail the Release's created date before the Series is stale: a count of days, weeks, months or years, such as P45D or P4M.",
          "type": "string",
          "pattern": "^P[1-9][0-9]*[DWMY]$"
        },
        "range": {
          "description": "Sanity range [low, high] for the writer's checks.",
          "type": "array",
          "prefixItems": [
            {
              "type": "number"
            },
            {
              "type": "number"
            }
          ],
          "items": false,
          "minItems": 2
        },
        "breaks": {
          "description": "Periods at which the Series stops being comparable with what came before (a rebasing or change of method). Values from the named Period on are on the new basis. Each has a data_note Annotation.",
          "type": "array",
          "items": {
            "title": "SeriesBreak",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "period",
              "note"
            ],
            "properties": {
              "period": {
                "$ref": "#/$defs/period"
              },
              "note": {
                "type": "string",
                "minLength": 1
              }
            }
          }
        },
        "recipe": {
          "$ref": "#/$defs/recipe"
        }
      }
    },
    "catalog": {
      "title": "Catalog",
      "description": "catalog.json: every Series this Release knows about, including withheld ones (by name, without values).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "series"
      ],
      "properties": {
        "series": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/catalogEntry"
          }
        }
      }
    },
    "observation": {
      "title": "Observation",
      "description": "One value of one Series for one Period. period_start and period_end are the first and last calendar day of the Period, both inclusive. A gap is an explicit Observation with value null and status missing: a Period is never simply left out.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "period",
        "period_start",
        "period_end",
        "value",
        "status"
      ],
      "properties": {
        "period": {
          "$ref": "#/$defs/period"
        },
        "period_start": {
          "$ref": "#/$defs/date"
        },
        "period_end": {
          "$ref": "#/$defs/date"
        },
        "value": {
          "type": [
            "number",
            "null"
          ]
        },
        "status": {
          "$ref": "#/$defs/observationStatus"
        }
      },
      "if": {
        "properties": {
          "status": {
            "enum": [
              "missing",
              "suppressed"
            ]
          }
        },
        "required": [
          "status"
        ]
      },
      "then": {
        "properties": {
          "value": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
          "value": {
            "type": "number"
          }
        }
      }
    },
    "seriesFile": {
      "title": "SeriesFile",
      "description": "series/{key}.json or derived/{key}.json. Observations are in Period order at the native frequency with no Period left out between the bounds (irregular series excepted). period_start and period_end are the bounds: the first Observation's period_start and the last one's period_end.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "freq",
        "representation",
        "period_start",
        "period_end",
        "observations"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/key"
        },
        "freq": {
          "$ref": "#/$defs/frequency"
        },
        "representation": {
          "$ref": "#/$defs/representation"
        },
        "period_start": {
          "$ref": "#/$defs/date"
        },
        "period_end": {
          "$ref": "#/$defs/date"
        },
        "observations": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/observation"
          }
        }
      }
    },
    "anchor": {
      "title": "Anchor",
      "description": "Where an Annotation sits on the time axis: a date, a span (end is inclusive; null means still running) or a Period.",
      "oneOf": [
        {
          "title": "DateAnchor",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "date"
          ],
          "properties": {
            "type": {
              "const": "date"
            },
            "date": {
              "$ref": "#/$defs/date"
            }
          }
        },
        {
          "title": "SpanAnchor",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "start",
            "end"
          ],
          "properties": {
            "type": {
              "const": "span"
            },
            "start": {
              "$ref": "#/$defs/date"
            },
            "end": {
              "anyOf": [
                {
                  "$ref": "#/$defs/date"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        },
        {
          "title": "PeriodAnchor",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "type",
            "period"
          ],
          "properties": {
            "type": {
              "const": "period"
            },
            "period": {
              "$ref": "#/$defs/period"
            }
          }
        }
      ]
    },
    "annotation": {
      "title": "Annotation",
      "description": "Anything drawn on a time axis that is not a Series. One shape for every layer (PLAN 5). An Annotation states what and when; it never says an Event caused a movement.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "kind",
        "anchor",
        "label",
        "ref",
        "source"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9][a-z0-9_.-]{0,127}$"
        },
        "kind": {
          "enum": [
            "event",
            "claim",
            "recession",
            "governance",
            "policy",
            "data_note"
          ]
        },
        "anchor": {
          "$ref": "#/$defs/anchor"
        },
        "series": {
          "description": "The Series this Annotation belongs to; absent means it applies to the whole time axis.",
          "type": "array",
          "items": {
            "$ref": "#/$defs/key"
          }
        },
        "label": {
          "type": "string",
          "minLength": 1
        },
        "ref": {
          "description": "Path of the content record behind this Annotation (an Event or Claim), or null.",
          "type": [
            "string",
            "null"
          ]
        },
        "source": {
          "anyOf": [
            {
              "title": "Citation",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "url"
              ],
              "properties": {
                "name": {
                  "type": "string"
                },
                "url": {
                  "type": "string",
                  "minLength": 1
                },
                "archive_url": {
                  "type": "string"
                }
              }
            },
            {
              "type": "null"
            }
          ]
        },
        "category": {
          "description": "The layer within a kind, such as an Event's category (political, financial, ...).",
          "type": "string"
        },
        "attributes": {
          "description": "Named facts a layer needs to draw itself, such as the party of a term of government. Never a judgment.",
          "type": "object",
          "additionalProperties": {
            "type": [
              "string",
              "number",
              "boolean"
            ]
          }
        }
      }
    },
    "annotationsFile": {
      "title": "AnnotationsFile",
      "description": "content/annotations.json.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "annotations"
      ],
      "properties": {
        "annotations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/annotation"
          }
        }
      }
    }
  }
};
