---
slug: "inflation"
title: "Inflation"
segment: economy_jobs
status: public
definition:
  quote: "The Consumer Price Index (CPI) is a measure of the average change over time in the prices paid by urban consumers for a market basket of consumer goods and services."
  source:
    name: "U.S. Bureau of Labor Statistics, Consumer Price Index"
    url: "https://www.bls.gov/cpi/"
    archive_url: "https://web.archive.org/web/20261108094840/https://www.bls.gov/cpi/"
main: "cpi_yoy"
series:
  - "cpi_yoy"
  - "cpi_nsa"
  - "cpi"
  - "corecpi_yoy"
  - "corecpi"
  - "rent_yoy"
  - "rent_cpi"
  - "us_infl"
  - "us_cpi"
companions:
  - series: "corecpi_yoy"
    relation: excludes_components
  - series: "rent_yoy"
    relation: component
  - series: "cpi_nsa"
    relation: input
range:
  series: "us_infl"
  coverage: "g20"
  indicator: "inflation"
  label: "G20"
events:
  - "2022-06-us-inflation-peaks-at-9-1"
---
