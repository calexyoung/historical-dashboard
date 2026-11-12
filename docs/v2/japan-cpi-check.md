# Japan CPI: the IMF's index against the Statistics Bureau's file

M14's first acceptance item: "Japan CPI matches the e-Stat file for the 25 months research 02
checked". v1's Japan CPI (the OECD's series, through FRED) ended in June 2021. v2 reads the
all-items index from the International Monetary Fund (`jp_cpi`, the Fund's series
`JPN.CPI._T.IX.M`). The Statistics Bureau of Japan's own 2020-base file on e-Stat is the
source of record, and in v2.0 it is used only for this comparison: no Series is read from it
and nothing from it is stored.

What is compared is stated in `checks/japan-cpi.json`; the command is
`python -m atlas crosscheck japan-cpi`; this page is what it found when it was run.

**No figure from either source is on this page or in the repository.** The run below asked
each source once, compared in memory and kept nothing. Neither source's register row is signed (D2), so
neither the IMF's bytes nor the Bureau's may be stored, and the committed test fixtures hold
invented values in the two sources' shapes.

## The rule

- The Bureau's file is held to its base first: its twelve months of 2020 must average 100
  (to within 0.05). The Bureau rebases every five years; a file on another base fails here
  and nothing is compared.
- The Fund's series must carry the reference period `2020A`, the one the register pins for
  it. A rebase on the Fund's side fails the read.
- A month agrees when the Fund's figure, rounded half up to one decimal, is the Bureau's
  figure. A month either side does not hold is a failure, never a pass.

## The run of 2026-11-11

| | |
|---|---|
| The Fund | `https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.STA/CPI/+/JPN.CPI._T.IX.M?dimensionAtObservation=TIME_PERIOD`, retrieved 2026-11-12T03:03:31Z (the evening of the 11th in New York). Reference period `2020A`. 861 months, 1955-01 to 2026-09, read by the `imf_sdmx` adapter, version 1 |
| The Bureau | `https://www.e-stat.go.jp/en/stat-search/file-download?statInfId=000032103842&fileKind=1` (served as `zmi2020s.csv`), retrieved 2026-11-12T03:03:32Z. Item `0001`, all items. Its 2020 months average 100. 681 months, 1970-01 to 2026-09 |
| Months compared | 2024-09 to 2026-09: the 25 months research 02 compared |
| Result | **25 of 25 months equal at one decimal.** Exit status 0 |

The same evening both IMF endpoints of the register (`imf-cpi-g20`, 19 series, 0.6 MB;
`imf-er-g20`, 16 series, 0.4 MB) were asked once through the adapter, in memory: both answers
were whole, every value was marked reported official data (CPI) or raw data (exchange rates),
and every value lay inside its Series' range in the Catalog. Nothing was kept.

## To run it again

```
.venv/bin/python -m atlas crosscheck japan-cpi --live
```

asks each source once and keeps nothing. With two files someone has fetched:
`--imf FILE --estat FILE`. Once the IMF's row is signed and the capture job has run:
`--store var/store --estat FILE` reads the Fund's side from the latest whole capture of
`imf-cpi-g20`.

## Still open

- The acceptance item is met by a live run, not by a committed fixture of real values: that
  waits for D2 (the `imf` and `e-stat` rows of the register).
- Only these 25 months were compared. Research 02 also asked for a long stretch of history
  and for the twelve-month changes against the Bureau's published headline rates; neither is
  done here.
- The e-Stat file's address carries a file ID that may change at the 2025-base revision. The
  check fails loudly if the file it is given is not on the 2020 base.
