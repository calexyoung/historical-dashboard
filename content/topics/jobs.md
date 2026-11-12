---
slug: "jobs"
title: "Jobs"
segment: economy_jobs
status: public
definition:
  quote: "The unemployment rate represents the number of unemployed people as a percentage of the labor force (the labor force is the sum of the employed and unemployed)."
  source:
    name: "U.S. Bureau of Labor Statistics, Concepts and Definitions (CPS)"
    url: "https://www.bls.gov/cps/definitions.htm"
    archive_url: "https://web.archive.org/web/20261105200306/https://www.bls.gov/cps/definitions.htm"
main: "unrate"
series:
  - "unrate"
  - "civpart"
  - "payems"
  - "wages"
  - "wages_yoy"
  - "real_wages"
companions:
  - series: "civpart"
    relation: same_survey
  - series: "payems"
    relation: same_release
  - series: "wages"
    relation: same_release
events: []
---
