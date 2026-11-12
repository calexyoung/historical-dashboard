# Hand-entered files: fixtures

Two files in the form `atlas/manual.py` reads (ADR 0030; `docs/method/capture.md`, "Hand-entered
files"), laid out as they would be in the repository so that a test can point the capture kit
at this directory as if it were the repository's root:

```
catalog/manual/invented-margins.json     a series file: two results of an invented election
catalog/manual/terms/invented-office.json   a terms file: two holders of an invented office
```

**Every value, name, citation and address in them is invented.** No election had these votes
and no page is at these addresses (the `.invalid` domain cannot exist). The repository's real
`catalog/manual/` holds no file: no row of the rights register is signed, and a committed
hand-entered file is a public copy of what its Origin published. `atlas check` refuses one whose
Origin's row does not allow it.
