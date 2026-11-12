// GENERATED from schema/release.schema.json by scripts/gen-schema.mjs. Do not edit.

export const SCHEMA_VERSION = "0.5.0";

/** Every version this reader knows; a writer writes the last. */
export const SCHEMA_VERSIONS: readonly string[] = ["0.1.0","0.2.0","0.3.0","0.4.0","0.5.0"];

export const releaseSchema: Record<string, unknown> = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mydashboards.co/macro-atlas/schema/release.schema.json",
  "title": "Release",
  "description": "Macro Atlas release contract, v0 (schema_version 0.5.0). A Release is a directory; this schema describes it gathered into one object: manifest.json, catalog.json, series/{key}.json, derived/{key}.json, vintages/{key}.json, content/annotations.json, content/events.json, content/claims.json, locks/{claim_id}.v{n}.lock.json, evidence/latest.json, content/highlights.json and search.json. It is the seam between the writer and every reader (PLAN 4.2). Conventions the schema cannot express, and the cross-file rules, are in schema/README.md. Structural validity is not authorisation: whether a series may appear on a Surface is decided by permits() and the rights register.",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "manifest",
    "catalog",
    "series",
    "derived",
    "vintages",
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
    "vintages": {
      "description": "vintages/{key}.json: what Macro Atlas has held for a stored Series over time (ADR 0022, ADR 0024). Optional per Series; a Series without one has no as-of answer.",
      "type": "object",
      "propertyNames": {
        "$ref": "#/$defs/key"
      },
      "additionalProperties": {
        "$ref": "#/$defs/vintageFile"
      }
    },
    "annotations": {
      "$ref": "#/$defs/annotationsFile"
    },
    "events": {
      "$ref": "#/$defs/eventsFile"
    },
    "claims": {
      "$ref": "#/$defs/claimsFile"
    },
    "locks": {
      "description": "locks/{claim_id}.v{n}.lock.json, by file name without .lock.json.",
      "type": "object",
      "propertyNames": {
        "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*\\.v[1-9][0-9]{0,3}$"
      },
      "additionalProperties": {
        "$ref": "#/$defs/claimLock"
      }
    },
    "latest": {
      "$ref": "#/$defs/latestFile"
    },
    "highlights": {
      "$ref": "#/$defs/highlightsFile"
    },
    "search": {
      "$ref": "#/$defs/searchFile"
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
      "description": "A calendar date, YYYY-MM-DD, in years 0001 to 9999. No time and no zone.",
      "type": "string",
      "format": "date",
      "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$"
    },
    "datetime": {
      "title": "Instant",
      "description": "An instant in UTC, written exactly as YYYY-MM-DDTHH:MM:SS, an optional fraction of up to nine digits, then Z. No offsets, no leap seconds, no lower case.",
      "type": "string",
      "format": "date-time",
      "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\\.[0-9]{1,9})?Z$"
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
      "pattern": "^(?!0000)[0-9]{4}(-Q[1-4]|-W[0-9]{2}|-[0-9]{2}(-[0-9]{2})?)?$"
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
          "description": "Version of this contract. Readers refuse a version they do not know. 0.2.0 added vintages/ and vintages_sha256; a 0.1.0 Release holds neither. 0.3.0 (M19) added content/events.json, which a 0.3.0 Release must have and an earlier one may not, and the rule that every Event is one Annotation. 0.4.0 (M20) added content/claims.json, which a 0.4.0 Release must have, locks/ and evidence/latest.json. 0.5.0 (M22) added content/highlights.json and search.json, both of which a 0.5.0 Release must have. Writers write the last one listed.",
          "enum": [
            "0.1.0",
            "0.2.0",
            "0.3.0",
            "0.4.0",
            "0.5.0"
          ]
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
              "description": "SHA-256 of the bytes of schema/rights-register.json at that version (ADR 0020); null in a Release built without the register (the legacy converter, the fixture).",
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
            "description": "sha256 is the hash of the file's exact bytes. vintages_sha256 is the hash of vintages/{key}.json, present exactly when that file is.",
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
              "vintages_sha256": {
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
    "recipeOrder": {
      "title": "RecipeOrder",
      "description": "Whether inputs are brought to the output frequency before or after the arithmetic. Always stated; there is no default.",
      "enum": [
        "aggregate_then_compute",
        "compute_then_aggregate"
      ]
    },
    "recipe": {
      "title": "Recipe",
      "description": "The declared rule that produces a Derived series. inputs are ordered: ratio is inputs[0] / inputs[1] and difference is inputs[0] - inputs[1], each with exactly two inputs; sum and product take two or more; pct_change takes one input and params.lag, a whole number of Periods at the frequency the arithmetic is done at: the Derived series' own under aggregate_then_compute, the input's under compute_then_aggregate (docs/method/transforms.md). order is always stated. The output's unit is the entry's own unit. Only the engine in packages/core computes a Recipe (ADR 0003); other code may only check its structure.",
      "oneOf": [
        {
          "title": "PairRecipe",
          "description": "ratio is inputs[0] / inputs[1]; difference is inputs[0] - inputs[1].",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "inputs",
            "order"
          ],
          "properties": {
            "op": {
              "enum": [
                "ratio",
                "difference"
              ]
            },
            "inputs": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/key"
              },
              "minItems": 2,
              "maxItems": 2
            },
            "order": {
              "$ref": "#/$defs/recipeOrder"
            }
          }
        },
        {
          "title": "CombineRecipe",
          "description": "sum and product of two or more inputs.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "inputs",
            "order"
          ],
          "properties": {
            "op": {
              "enum": [
                "sum",
                "product"
              ]
            },
            "inputs": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/key"
              },
              "minItems": 2
            },
            "order": {
              "$ref": "#/$defs/recipeOrder"
            }
          }
        },
        {
          "title": "PercentChangeRecipe",
          "description": "Percent change of one input from params.lag Periods earlier, counted at the frequency the arithmetic is done at.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "op",
            "inputs",
            "order",
            "params"
          ],
          "properties": {
            "op": {
              "const": "pct_change"
            },
            "inputs": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/key"
              },
              "minItems": 1,
              "maxItems": 1
            },
            "order": {
              "$ref": "#/$defs/recipeOrder"
            },
            "params": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "lag"
              ],
              "properties": {
                "lag": {
                  "type": "integer",
                  "minimum": 1
                }
              }
            }
          }
        }
      ]
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
    "vintageRow": {
      "title": "VintageRow",
      "description": "One version of one Observation: what was held for a Period from recorded_from up to, not including, recorded_to (null: held now). Both are retrieval times of Captures, never the time a Release was written. deleted marks a tombstone: the Period was held, was asked about again and was no longer in a complete answer. provider_from is when the Origin published the version, where the Origin or an archive of its releases dates it; provider_precision says whether that is a day or an instant (a day is written as that day at 00:00:00Z). metadata is the hash of the metadata the version was recorded under.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "period",
        "period_start",
        "period_end",
        "value",
        "status",
        "deleted",
        "recorded_from",
        "recorded_to",
        "provider_from",
        "provider_to",
        "provider_precision",
        "channel",
        "metadata"
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
          "anyOf": [
            {
              "$ref": "#/$defs/observationStatus"
            },
            {
              "type": "null"
            }
          ]
        },
        "deleted": {
          "type": "boolean"
        },
        "recorded_from": {
          "$ref": "#/$defs/datetime"
        },
        "recorded_to": {
          "anyOf": [
            {
              "$ref": "#/$defs/datetime"
            },
            {
              "type": "null"
            }
          ]
        },
        "provider_from": {
          "anyOf": [
            {
              "$ref": "#/$defs/datetime"
            },
            {
              "type": "null"
            }
          ]
        },
        "provider_to": {
          "anyOf": [
            {
              "$ref": "#/$defs/datetime"
            },
            {
              "type": "null"
            }
          ]
        },
        "provider_precision": {
          "enum": [
            "date",
            "datetime",
            null
          ]
        },
        "channel": {
          "type": "string",
          "minLength": 1
        },
        "metadata": {
          "$ref": "#/$defs/sha256"
        }
      },
      "if": {
        "properties": {
          "deleted": {
            "const": true
          }
        },
        "required": [
          "deleted"
        ]
      },
      "then": {
        "properties": {
          "value": {
            "type": "null"
          },
          "status": {
            "type": "null"
          }
        }
      },
      "else": {
        "properties": {
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
      }
    },
    "vintageFile": {
      "title": "VintageFile",
      "description": "vintages/{key}.json: every version of every Observation of a stored Series that the Release may show, the metadata history, and the complete Captures recorded for it. rows are in Period order, and a Period's versions in the order they were recorded. captures are oldest first; one whose change is none is a capture confirmation, and confirms only the Periods inside its scope. provider_coverage is the span over which the Origin's own record of its releases is known to be complete, or null when the Series has only Atlas-observed vintages. Only packages/core resolves an as-of question from this file (ADR 0003, docs/method/vintage-resolution.md).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "freq",
        "representation",
        "provider_coverage",
        "metadata",
        "captures",
        "rows"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/key"
        },
        "freq": {
          "$ref": "#/$defs/frequency"
        },
        "representation": {
          "description": "Always native: v1's legacy Series have no vintages.",
          "const": "native"
        },
        "provider_coverage": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "title": "ProviderCoverage",
              "type": "object",
              "additionalProperties": false,
              "required": [
                "from",
                "to"
              ],
              "properties": {
                "from": {
                  "$ref": "#/$defs/datetime"
                },
                "to": {
                  "$ref": "#/$defs/datetime"
                }
              }
            }
          ]
        },
        "metadata": {
          "description": "The metadata history, oldest first: each was in force from recorded_from until the next one's. metadata is a fixed selection of what the vintage store recorded: the name, unit and adjustment declared, the Source, and what the rights register said of the Origin when the bytes were fetched. rights is a record of that day and authorises nothing: what may be shown is decided by today's register.",
          "type": "array",
          "minItems": 1,
          "items": {
            "title": "VintageMetadata",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "hash",
              "recorded_from",
              "metadata"
            ],
            "properties": {
              "hash": {
                "$ref": "#/$defs/sha256"
              },
              "recorded_from": {
                "$ref": "#/$defs/datetime"
              },
              "metadata": {
                "title": "RecordedMetadata",
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "name",
                  "unit",
                  "source",
                  "rights"
                ],
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "unit": {
                    "type": "string",
                    "minLength": 1
                  },
                  "seasonal_adjustment": {
                    "type": "string",
                    "minLength": 1
                  },
                  "source": {
                    "$ref": "#/$defs/source"
                  },
                  "rights": {
                    "anyOf": [
                      {
                        "type": "null"
                      },
                      {
                        "title": "RightsThen",
                        "type": "object",
                        "additionalProperties": false,
                        "required": [
                          "licence_class",
                          "attribution"
                        ],
                        "properties": {
                          "licence_class": {
                            "type": "string",
                            "minLength": 1
                          },
                          "attribution": {
                            "type": [
                              "string",
                              "null"
                            ]
                          }
                        }
                      }
                    ]
                  }
                }
              }
            }
          }
        },
        "captures": {
          "type": "array",
          "items": {
            "title": "VintageCapture",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "retrieved_at",
              "scope",
              "change"
            ],
            "properties": {
              "retrieved_at": {
                "$ref": "#/$defs/datetime"
              },
              "scope": {
                "description": "The first and last calendar day the source was asked about; null for no bound.",
                "type": "array",
                "minItems": 2,
                "maxItems": 2,
                "items": {
                  "anyOf": [
                    {
                      "$ref": "#/$defs/date"
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "change": {
                "enum": [
                  "first",
                  "revision",
                  "metadata",
                  "none"
                ]
              }
            }
          }
        },
        "rows": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/vintageRow"
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
          "description": "Path of the content record behind this Annotation (an Event: content/events/{id}.md), or null. From 0.3.0 every Annotation of kind event names its Event here.",
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
        },
        "provenance": {
          "title": "AnnotationProvenance",
          "description": "Where an Annotation that is not Macro Atlas's own content came from (0.3.0): the Origin and dataset of the hand-entered file, or of v1's file, it was projected from. The rights check of a Release asks the gate about it. An Annotation in v1's legacy representation is never in a public-profile Release.",
          "type": "object",
          "additionalProperties": false,
          "required": [
            "producer",
            "dataset",
            "via",
            "representation"
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
            "via": {
              "type": "string",
              "minLength": 1
            },
            "representation": {
              "$ref": "#/$defs/representation"
            }
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
    },
    "eventCitation": {
      "title": "EventCitation",
      "description": "Where an Event can be checked: an address and an archived copy of it, or the reason there is none. One or the other, never both and never neither.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "url"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1
        },
        "url": {
          "type": "string",
          "minLength": 1
        },
        "archive_url": {
          "type": "string",
          "minLength": 1
        },
        "no_archive": {
          "type": "string",
          "minLength": 1
        }
      },
      "oneOf": [
        {
          "properties": {
            "archive_url": {
              "type": "string"
            }
          },
          "required": [
            "archive_url"
          ]
        },
        {
          "properties": {
            "no_archive": {
              "type": "string"
            }
          },
          "required": [
            "no_archive"
          ]
        }
      ]
    },
    "event": {
      "title": "Event",
      "description": "One Event as a Release carries it (content/events/{id}.md compiled; schema/event.schema.json is the authoring form). There is no field for a finding, a rating or an effect.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "date",
        "date_precision",
        "title",
        "category",
        "status",
        "topics",
        "related_series",
        "sources",
        "description"
      ],
      "properties": {
        "id": {
          "description": "Permanent. The date as written in `date`, then a slug. The file is named for it.",
          "type": "string",
          "maxLength": 100,
          "pattern": "^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?-[a-z0-9]+(-[a-z0-9]+)*$"
        },
        "date": {
          "description": "When it happened, or began: a day, a month or a year, as date_precision says. No day is made up.",
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$"
        },
        "end": {
          "description": "The last day, month or year of an Event that spans time, inclusive, in the precision of `date`. An Event still running has no place here yet: it is recorded when it has ended.",
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$"
        },
        "date_precision": {
          "enum": [
            "day",
            "month",
            "year"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "pattern": "^\\S(.*\\S)?$"
        },
        "category": {
          "description": "v1's five, then disaster, infrastructure and legislation (PLAN 5).",
          "enum": [
            "political",
            "financial",
            "geopolitical",
            "health",
            "policy",
            "disaster",
            "infrastructure",
            "legislation"
          ]
        },
        "status": {
          "description": "A draft is never in a public-profile Release.",
          "enum": [
            "draft",
            "public"
          ]
        },
        "topics": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"
          }
        },
        "related_series": {
          "description": "Keys of Series in the Catalog that a reader may want beside this Event. Not a statement that the Event moved them.",
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^[a-z][a-z0-9_]{0,63}$"
          }
        },
        "sources": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/eventCitation"
          }
        },
        "description": {
          "description": "The Event's own text: what happened and when, supported by the cited sources. It does not evaluate and never says an Event caused a movement. May be empty.",
          "type": "string"
        }
      }
    },
    "eventsFile": {
      "title": "EventsFile",
      "description": "content/events.json (0.3.0): the Events, in the order of time. A public-profile Release holds no draft.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "events"
      ],
      "properties": {
        "events": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/event"
          }
        }
      }
    },
    "claimWindow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to"
      ],
      "properties": {
        "from": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$"
        },
        "to": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$"
        }
      },
      "title": "ClaimWindow",
      "description": "Calendar dates, both inclusive."
    },
    "claimReading": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "series",
        "transform",
        "measure"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
          "maxLength": 40,
          "description": "Names the Reading within its Claim. Permanent once locked."
        },
        "series": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_]{0,63}$"
        },
        "freq": {
          "description": "A slower frequency to bring the Series to before anything else. Absent: the Series' own.",
          "enum": [
            "weekly",
            "monthly",
            "quarterly",
            "annual"
          ]
        },
        "transform": {
          "description": "One of the engine's Transforms (docs/method/transforms.md). rebase, z and drawdown depend on a window and go only with a measure that has one.",
          "enum": [
            "lin",
            "chg",
            "ch1",
            "pch",
            "pc1",
            "pca",
            "log",
            "rebase",
            "z",
            "drawdown"
          ]
        },
        "measure": {
          "description": "The closed list (PLAN 4.5). Each returns numbers, never true or false.",
          "enum": [
            "value_at",
            "change",
            "extreme",
            "rank",
            "difference"
          ]
        },
        "period": {
          "description": "value_at, rank: the Period measured, as a label at the Reading's frequency.",
          "type": "string",
          "minLength": 4,
          "maxLength": 10
        },
        "periods": {
          "description": "difference: two Periods; the answer is the second less the first.",
          "type": "array",
          "minItems": 2,
          "maxItems": 2,
          "items": {
            "type": "string",
            "minLength": 4,
            "maxLength": 10
          }
        },
        "window": {
          "$ref": "#/$defs/claimWindow"
        },
        "which": {
          "description": "extreme: the largest or the smallest value.",
          "enum": [
            "max",
            "min"
          ]
        },
        "order": {
          "description": "rank: whether 1 is the highest value or the lowest.",
          "enum": [
            "highest",
            "lowest"
          ]
        },
        "alternative_windows": {
          "description": "Other windows the same measure is taken over, so a reader sees how much the declared one matters (Window sensitivity). Only with change, extreme or rank.",
          "type": "array",
          "maxItems": 12,
          "items": {
            "$ref": "#/$defs/claimWindow"
          }
        }
      },
      "title": "ClaimReading",
      "description": "One way to turn a Claim's words into something measurable (CONTEXT.md, Reading). Which fields go with which measure is in docs/method/claims.md; both atlas check and the engine hold a Reading to it. There is no field for what the figures show."
    },
    "claimSource": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "url",
        "archive_url",
        "locator",
        "kind"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$"
        },
        "url": {
          "type": "string",
          "pattern": "^https://\\S+$"
        },
        "archive_url": {
          "type": "string",
          "pattern": "^https://\\S+$",
          "description": "An archived copy of the address. A Claim's source has no exception."
        },
        "locator": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$",
          "description": "Where in the source the words are: a time in a recording, a page, a paragraph."
        },
        "kind": {
          "description": "What kind of record it is. Two sources of one Claim are different records of the statement.",
          "enum": [
            "recording",
            "transcript",
            "own_publication",
            "report"
          ]
        }
      },
      "title": "ClaimSource"
    },
    "claimant": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "role",
        "party"
      ],
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$"
        },
        "role": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$",
          "description": "The office or position held when the Claim was made."
        },
        "party": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$",
          "description": "The party at the time; \"none\" for a person with no party."
        }
      },
      "title": "Claimant"
    },
    "claimCorrection": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "date",
        "reason"
      ],
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\S([\\s\\S]*\\S)?$"
        }
      },
      "title": "ClaimCorrection",
      "description": "A dated, public change to the Claim after publication, with the reason (CONTEXT.md, Correction)."
    },
    "evidenceUnavailable": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "reason",
        "message"
      ],
      "properties": {
        "reason": {
          "type": "string",
          "pattern": "^[a-z_]+$"
        },
        "message": {
          "type": "string"
        }
      },
      "title": "EvidenceUnavailable",
      "description": "Why there is no answer. A reason code and a sentence written by the engine; it states what is missing and judges nothing."
    },
    "evidenceFigure": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "value"
      ],
      "properties": {
        "name": {
          "enum": [
            "value",
            "start",
            "end",
            "change",
            "pct_change",
            "extreme",
            "n",
            "rank",
            "of",
            "a",
            "b",
            "difference"
          ]
        },
        "value": {
          "description": "A number, or null with `empty`. Never true or false.",
          "type": [
            "number",
            "null"
          ]
        },
        "period": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "empty": {
          "description": "Why the figure has no value.",
          "type": "string",
          "pattern": "^[a-z_]+$"
        }
      },
      "title": "EvidenceFigure",
      "description": "One number a Measure returned (CONTEXT.md, Measure)."
    },
    "rightsLineage": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "origin",
        "dataset",
        "channel",
        "representation"
      ],
      "properties": {
        "origin": {
          "type": "string",
          "minLength": 1
        },
        "dataset": {
          "type": "string",
          "minLength": 1
        },
        "channel": {
          "type": "string",
          "minLength": 1
        },
        "representation": {
          "$ref": "#/$defs/representation"
        }
      },
      "title": "RightsLineage",
      "description": "One Origin, dataset and Channel that values came through: a row for the rights gate."
    },
    "evidenceInput": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "key",
        "basis",
        "capture_gap",
        "same_day_release",
        "unit",
        "last_capture"
      ],
      "properties": {
        "key": {
          "$ref": "#/$defs/key"
        },
        "basis": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "enum": [
                "provider",
                "atlas_observed",
                "legacy",
                "uncertain",
                "unavailable"
              ]
            }
          ]
        },
        "capture_gap": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "from",
                "to",
                "missed_days",
                "changed_across"
              ],
              "properties": {
                "from": {
                  "$ref": "#/$defs/datetime"
                },
                "to": {
                  "oneOf": [
                    {
                      "type": "null"
                    },
                    {
                      "$ref": "#/$defs/datetime"
                    }
                  ]
                },
                "missed_days": {
                  "type": "integer",
                  "minimum": 0
                },
                "changed_across": {
                  "type": [
                    "boolean",
                    "null"
                  ]
                }
              },
              "title": "EvidenceCaptureGap"
            }
          ]
        },
        "same_day_release": {
          "type": "boolean"
        },
        "unit": {
          "type": "string"
        },
        "last_capture": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/datetime"
            }
          ]
        }
      },
      "title": "EvidenceInput",
      "description": "One stored Series an Evidence row rests on, as it was resolved."
    },
    "evidenceSensitivity": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to",
        "figures"
      ],
      "properties": {
        "from": {
          "$ref": "#/$defs/date"
        },
        "to": {
          "$ref": "#/$defs/date"
        },
        "figures": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidenceFigure"
          }
        },
        "unavailable": {
          "$ref": "#/$defs/evidenceUnavailable"
        }
      },
      "title": "EvidenceSensitivity",
      "description": "The same Measure over one alternative window (CONTEXT.md, Window sensitivity)."
    },
    "evidenceRow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "state",
        "as_of",
        "cutoff",
        "basis",
        "same_day_release",
        "inputs",
        "unit",
        "figures",
        "window_sensitivity",
        "release_id",
        "semantics_version"
      ],
      "properties": {
        "state": {
          "enum": [
            "then",
            "now_when_checked",
            "latest"
          ]
        },
        "as_of": {
          "description": "The day or instant asked about (then); null for a Release's own state.",
          "type": [
            "string",
            "null"
          ]
        },
        "cutoff": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "instant",
                "day",
                "precision",
                "zone"
              ],
              "properties": {
                "instant": {
                  "$ref": "#/$defs/datetime"
                },
                "day": {
                  "$ref": "#/$defs/date"
                },
                "precision": {
                  "enum": [
                    "date",
                    "datetime"
                  ]
                },
                "zone": {
                  "const": "America/New_York"
                }
              },
              "title": "EvidenceCutoff"
            }
          ]
        },
        "basis": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "enum": [
                "provider",
                "atlas_observed",
                "legacy",
                "uncertain",
                "unavailable"
              ]
            }
          ]
        },
        "unavailable": {
          "$ref": "#/$defs/evidenceUnavailable"
        },
        "same_day_release": {
          "type": "boolean"
        },
        "inputs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidenceInput"
          }
        },
        "unit": {
          "description": "The Series' unit in force for this row, before the Transform.",
          "type": [
            "string",
            "null"
          ]
        },
        "figures": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidenceFigure"
          }
        },
        "window_sensitivity": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/evidenceSensitivity"
          }
        },
        "release_id": {
          "type": "string"
        },
        "semantics_version": {
          "type": "string"
        }
      },
      "title": "EvidenceRow",
      "description": "The result of one Reading against one state of the data (CONTEXT.md, Evidence row): then, now when checked, or latest. Numbers and where they came from; no field says what they show about the Claim."
    },
    "resolvedPeriod": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "period",
        "start",
        "end"
      ],
      "properties": {
        "period": {
          "type": "string"
        },
        "start": {
          "$ref": "#/$defs/date"
        },
        "end": {
          "$ref": "#/$defs/date"
        }
      },
      "title": "ResolvedPeriod"
    },
    "resolvedWindow": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to",
        "periods"
      ],
      "properties": {
        "from": {
          "$ref": "#/$defs/date"
        },
        "to": {
          "$ref": "#/$defs/date"
        },
        "periods": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/resolvedPeriod"
          }
        }
      },
      "title": "ResolvedWindow",
      "description": "A window, and for a change the first and last Period that start inside it, fixed by the calendar before any value is looked at."
    },
    "lockedReading": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "series",
        "freq",
        "unit",
        "transform",
        "measure",
        "recipe",
        "periods",
        "window",
        "alternative_windows",
        "then",
        "now_when_checked"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
          "maxLength": 40,
          "description": "Names the Reading within its Claim. Permanent once locked."
        },
        "series": {
          "$ref": "#/$defs/key"
        },
        "freq": {
          "$ref": "#/$defs/frequency"
        },
        "unit": {
          "type": "string"
        },
        "transform": {
          "description": "One of the engine's Transforms (docs/method/transforms.md). rebase, z and drawdown depend on a window and go only with a measure that has one.",
          "enum": [
            "lin",
            "chg",
            "ch1",
            "pch",
            "pc1",
            "pca",
            "log",
            "rebase",
            "z",
            "drawdown"
          ]
        },
        "measure": {
          "description": "The closed list (PLAN 4.5). Each returns numbers, never true or false.",
          "enum": [
            "value_at",
            "change",
            "extreme",
            "rank",
            "difference"
          ]
        },
        "recipe": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "key",
                "recipe",
                "rests_on"
              ],
              "properties": {
                "key": {
                  "$ref": "#/$defs/key"
                },
                "recipe": {
                  "$ref": "#/$defs/recipe"
                },
                "rests_on": {
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/key"
                  }
                }
              },
              "title": "RecipeIdentity"
            }
          ]
        },
        "periods": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/resolvedPeriod"
          }
        },
        "window": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/resolvedWindow"
            }
          ]
        },
        "alternative_windows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/resolvedWindow"
          }
        },
        "then": {
          "$ref": "#/$defs/evidenceRow"
        },
        "now_when_checked": {
          "$ref": "#/$defs/evidenceRow"
        }
      },
      "title": "LockedReading",
      "description": "What one Reading resolved to and its two locked Evidence rows."
    },
    "claimRecord": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "claimant",
        "said_on",
        "venue",
        "sources",
        "readings",
        "readings_not_measured",
        "selection_note",
        "checked_on",
        "quote"
      ],
      "properties": {
        "claimant": {
          "$ref": "#/$defs/claimant"
        },
        "said_on": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "The New York calendar day the statement was made."
        },
        "said_at": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
          "description": "The instant it was made, in UTC, when known. It falls on said_on in New York. With it the Cutoff is that instant; without it, 00:00 New York on said_on (D7)."
        },
        "venue": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$"
        },
        "sources": {
          "description": "Two or more records of the statement, each archived (ADR 0011).",
          "type": "array",
          "minItems": 2,
          "items": {
            "$ref": "#/$defs/claimSource"
          }
        },
        "readings": {
          "type": "array",
          "maxItems": 12,
          "items": {
            "$ref": "#/$defs/claimReading"
          }
        },
        "readings_not_measured": {
          "description": "Other ways the words could be read that this record does not measure, each in a line.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300,
            "pattern": "^\\S(.*\\S)?$"
          }
        },
        "selection_note": {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\S([\\s\\S]*\\S)?$",
          "description": "Why this statement was recorded."
        },
        "checked_on": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "The New York calendar day the Claim was recorded and its figures computed (now when checked)."
        },
        "quote": {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\S([\\s\\S]*\\S)?$",
          "description": "The statement, verbatim."
        }
      },
      "title": "ClaimRecord",
      "description": "The part of a Claim a lock freezes: the statement, who made it, where it can be checked, and how it is read. Its status, topics and corrections are not frozen."
    },
    "claimLock": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "format",
        "claim_id",
        "version",
        "locked_at",
        "reason",
        "supersedes",
        "record",
        "record_sha256",
        "release",
        "semantics_version",
        "rights_used",
        "readings",
        "lock_sha256"
      ],
      "properties": {
        "format": {
          "const": 1
        },
        "claim_id": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$"
        },
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "locked_at": {
          "$ref": "#/$defs/datetime",
          "description": "The instant the figures were computed: when the Claim was checked."
        },
        "reason": {
          "description": "Why the Claim was recorded afresh; null for the first lock.",
          "type": [
            "string",
            "null"
          ],
          "minLength": 1
        },
        "supersedes": {
          "description": "The version this one follows; null for the first.",
          "type": [
            "integer",
            "null"
          ],
          "minimum": 1
        },
        "record": {
          "$ref": "#/$defs/claimRecord"
        },
        "record_sha256": {
          "$ref": "#/$defs/sha256"
        },
        "release": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "release_id",
            "created",
            "profile"
          ],
          "properties": {
            "release_id": {
              "type": "string"
            },
            "created": {
              "$ref": "#/$defs/datetime"
            },
            "profile": {
              "$ref": "#/$defs/profile"
            }
          },
          "title": "LockRelease",
          "description": "The Release the rows were computed against. Retention keeps it."
        },
        "semantics_version": {
          "type": "string"
        },
        "rights_used": {
          "description": "Every Origin, dataset and Channel the locked numbers came through, history included.",
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/rightsLineage"
          }
        },
        "readings": {
          "type": "array",
          "minItems": 1,
          "items": {
            "$ref": "#/$defs/lockedReading"
          }
        },
        "lock_sha256": {
          "$ref": "#/$defs/sha256",
          "description": "The hash of the rest of the file as the writer serialises it. A lock is never edited."
        }
      },
      "title": "ClaimLock",
      "description": "locks/{claim_id}.v{n}.lock.json (0.4.0): the frozen record of a Claim's then and now-when-checked Evidence rows and its Window sensitivity (CONTEXT.md, Claim lock; PLAN 4.5). Append-only: recording the Claim afresh adds a version with a reason. No field holds a finding, a rating or a label."
    },
    "claimLockListed": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "version",
        "locked_at",
        "reason",
        "record_sha256",
        "state"
      ],
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 1
        },
        "locked_at": {
          "$ref": "#/$defs/datetime"
        },
        "reason": {
          "type": [
            "string",
            "null"
          ]
        },
        "record_sha256": {
          "$ref": "#/$defs/sha256"
        },
        "state": {
          "description": "in_release: the lock's file is in this Release. withdrawn: its numbers may not be shown now (a permission went, or a Series was withdrawn); the lock is named and its file is absent. not_carried: the writer of this Release computes no latest row, so it carries no lock.",
          "enum": [
            "in_release",
            "withdrawn",
            "not_carried"
          ]
        },
        "sha256": {
          "$ref": "#/$defs/sha256",
          "description": "The hash of the lock's file. Present exactly when it is in the Release."
        },
        "why": {
          "description": "Why the lock's file is absent.",
          "type": "string",
          "minLength": 1
        }
      },
      "title": "ClaimLockListed"
    },
    "claim": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "claimant",
        "said_on",
        "venue",
        "sources",
        "readings",
        "readings_not_measured",
        "selection_note",
        "checked_on",
        "quote",
        "corrections",
        "topics",
        "status",
        "locks"
      ],
      "properties": {
        "id": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$",
          "description": "Permanent: said_on, then a slug. The file is named for it."
        },
        "claimant": {
          "$ref": "#/$defs/claimant"
        },
        "said_on": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "The New York calendar day the statement was made."
        },
        "said_at": {
          "type": "string",
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
          "description": "The instant it was made, in UTC, when known. It falls on said_on in New York. With it the Cutoff is that instant; without it, 00:00 New York on said_on (D7)."
        },
        "venue": {
          "type": "string",
          "minLength": 1,
          "maxLength": 300,
          "pattern": "^\\S(.*\\S)?$"
        },
        "sources": {
          "description": "Two or more records of the statement, each archived (ADR 0011).",
          "type": "array",
          "minItems": 2,
          "items": {
            "$ref": "#/$defs/claimSource"
          }
        },
        "readings": {
          "type": "array",
          "maxItems": 12,
          "items": {
            "$ref": "#/$defs/claimReading"
          }
        },
        "readings_not_measured": {
          "description": "Other ways the words could be read that this record does not measure, each in a line.",
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 300,
            "pattern": "^\\S(.*\\S)?$"
          }
        },
        "selection_note": {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\S([\\s\\S]*\\S)?$",
          "description": "Why this statement was recorded."
        },
        "checked_on": {
          "type": "string",
          "pattern": "^(?!0000)[0-9]{4}-[0-9]{2}-[0-9]{2}$",
          "description": "The New York calendar day the Claim was recorded and its figures computed (now when checked)."
        },
        "corrections": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/claimCorrection"
          }
        },
        "topics": {
          "type": "array",
          "uniqueItems": true,
          "items": {
            "type": "string",
            "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"
          }
        },
        "status": {
          "description": "A draft is never in a public-profile Release. Only a person makes a Claim public (D7).",
          "enum": [
            "draft",
            "public"
          ]
        },
        "quote": {
          "type": "string",
          "minLength": 1,
          "pattern": "^\\S([\\s\\S]*\\S)?$",
          "description": "The statement, verbatim."
        },
        "locks": {
          "description": "Every lock of the Claim, oldest first.",
          "type": "array",
          "items": {
            "$ref": "#/$defs/claimLockListed"
          }
        }
      },
      "title": "Claim",
      "description": "A Claim in a Release (CONTEXT.md): the record as its file holds it, the quote, and its locks by name. No field for a finding, a rating, a label or a context flag."
    },
    "claimsFile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "claims"
      ],
      "properties": {
        "claims": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/claim"
          }
        }
      },
      "title": "ClaimsFile",
      "description": "content/claims.json (0.4.0): the Claims, oldest first. A public-profile Release holds no draft."
    },
    "driftEntry": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "window",
        "figure",
        "field",
        "locked",
        "now"
      ],
      "properties": {
        "kind": {
          "description": "latest_differs: the latest row is not the locked now-when-checked row. then_differs: the then row, computed again on this Release, is not the locked one.",
          "enum": [
            "latest_differs",
            "then_differs"
          ]
        },
        "window": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/claimWindow"
            }
          ]
        },
        "figure": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "enum": [
                "value",
                "start",
                "end",
                "change",
                "pct_change",
                "extreme",
                "n",
                "rank",
                "of",
                "a",
                "b",
                "difference"
              ]
            }
          ]
        },
        "field": {
          "enum": [
            "value",
            "period",
            "status",
            "empty",
            "unit",
            "availability"
          ]
        },
        "locked": {
          "type": [
            "number",
            "string",
            "null"
          ]
        },
        "now": {
          "type": [
            "number",
            "string",
            "null"
          ]
        }
      },
      "title": "DriftEntry",
      "description": "One place where a row computed on this Release is not the locked one. It states the difference and names no cause; only a person re-locks."
    },
    "latestReading": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "latest",
        "refused",
        "drift"
      ],
      "properties": {
        "id": {
          "type": "string",
          "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
          "maxLength": 40,
          "description": "Names the Reading within its Claim. Permanent once locked."
        },
        "latest": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/evidenceRow"
            }
          ]
        },
        "refused": {
          "oneOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/evidenceUnavailable"
            }
          ]
        },
        "drift": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/driftEntry"
          }
        }
      },
      "title": "LatestReading",
      "description": "One locked Reading on this Release: its latest row, or why this Release cannot measure it, and the drift."
    },
    "latestClaim": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "claim_id",
        "lock_version",
        "rights_used",
        "readings"
      ],
      "properties": {
        "claim_id": {
          "type": "string",
          "maxLength": 100,
          "pattern": "^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9]+(-[a-z0-9]+)*$"
        },
        "lock_version": {
          "type": "integer",
          "minimum": 1
        },
        "rights_used": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/rightsLineage"
          }
        },
        "readings": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/latestReading"
          }
        }
      },
      "title": "LatestClaim"
    },
    "latestFile": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "semantics_version",
        "claims"
      ],
      "properties": {
        "semantics_version": {
          "type": "string"
        },
        "claims": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/latestClaim"
          }
        }
      },
      "title": "LatestFile",
      "description": "evidence/latest.json (0.4.0): for the newest lock of each Claim whose lock is in the Release, the latest Evidence row of every Reading, recomputed by the engine on this Release, and the drift report. Present exactly when the Release holds a lock."
    },
    "highlightsFile": {
      "title": "HighlightsFile",
      "description": "content/highlights.json (0.5.0): the headline Series of each Segment, chosen by an editor (CONTEXT.md, Highlights, Overview). All six Segments, once each, in the order of the Overview. The first Series of a Segment is its row of the Overview; all of them are rows of Highlights. Every key is a Series of this Release's catalog.json in that Segment. It names Series and holds no value; a Withheld Series may be named.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "segments"
      ],
      "properties": {
        "segments": {
          "type": "array",
          "minItems": 6,
          "maxItems": 6,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "segment",
              "series"
            ],
            "properties": {
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
              "series": {
                "type": "array",
                "uniqueItems": true,
                "maxItems": 24,
                "items": {
                  "$ref": "#/$defs/key"
                }
              }
            }
          }
        }
      }
    },
    "searchEntry": {
      "title": "SearchEntry",
      "description": "One thing a reader can search for: a Series, an Event or a Claim of this Release. Words only: a name, the text that describes it, and keywords. No field holds an Observation's value, and both validators hold every entry to the projection of the Release's own catalog.json, content/events.json and content/claims.json (schema/README.md).",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "kind",
        "id",
        "title",
        "text",
        "keywords"
      ],
      "properties": {
        "kind": {
          "enum": [
            "series",
            "event",
            "claim"
          ]
        },
        "id": {
          "description": "The Series key, the Event id or the Claim id: what the page's address ends in.",
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "text": {
          "description": "A Series' description, an Event's description, a Claim's quote. Empty when there is none.",
          "type": "string"
        },
        "keywords": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1
          }
        },
        "withheld": {
          "description": "A Series only: it is Withheld in this Release (listed by name, no values anywhere).",
          "const": true
        }
      }
    },
    "searchFile": {
      "title": "SearchFile",
      "description": "search.json (0.5.0): one entry for every Series of catalog.json, then every Event of content/events.json, then every Claim of content/claims.json, each in that file's order. A public-profile Release holds no draft, so its index names none.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "entries"
      ],
      "properties": {
        "entries": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/searchEntry"
          }
        }
      }
    }
  }
};
