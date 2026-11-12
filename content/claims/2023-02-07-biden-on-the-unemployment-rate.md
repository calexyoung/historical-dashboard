---
id: "2023-02-07-biden-on-the-unemployment-rate"
claimant:
  name: "Joseph R. Biden, Jr."
  role: "President of the United States"
  party: "Democratic"
said_on: "2023-02-07"
venue: "Address Before a Joint Session of the Congress on the State of the Union, U.S. Capitol"
sources:
  - name: "Daily Compilation of Presidential Documents, DCPD-202300096"
    url: "https://www.govinfo.gov/content/pkg/DCPD-202300096/html/DCPD-202300096.htm"
    archive_url: "https://web.archive.org/web/20230315032647/https://www.govinfo.gov/content/pkg/DCPD-202300096/html/DCPD-202300096.htm"
    locator: "the paragraph that begins \"Well, folks, so let's look at the results.\""
    kind: "transcript"
  - name: "Congressional Record, House, 7 February 2023"
    url: "https://www.congress.gov/118/crec/2023/02/07/169/25/CREC-2023-02-07-pt1-PgH728-3.pdf"
    archive_url: "https://web.archive.org/web/20230329054328/https://www.congress.gov/118/crec/2023/02/07/169/25/CREC-2023-02-07-pt1-PgH728-3.pdf"
    locator: "Congressional Record, page H730; the Record prints it as \"The unemployment rate is at 3.4 percent, a 50-year low\""
    kind: "transcript"
readings:
  - id: "rate-in-january-2023"
    series: "unrate"
    transform: "lin"
    measure: "value_at"
    period: "2023-01"
  - id: "rank-over-fifty-years"
    series: "unrate"
    transform: "lin"
    measure: "rank"
    period: "2023-01"
    order: "lowest"
    window:
      from: "1973-02-01"
      to: "2023-01-31"
    alternative_windows:
      - from: "1969-01-01"
        to: "2023-01-31"
      - from: "1948-01-01"
        to: "2023-01-31"
readings_not_measured:
  - "The rate before it is rounded to one decimal place."
  - "The rate for a group other than the civilian noninstitutional population aged 16 and over."
  - "Each earlier month as it was first published, before later revisions."
selection_note: "A State of the Union address that gives a figure and a span of years the data can be set beside. Kept as the first worked example of a claim file."
checked_on: "2026-11-12"
corrections: []
topics:
  - "jobs"
status: "draft"
---

But unemployment rate is at 3.4 percent, a 50-year low.
