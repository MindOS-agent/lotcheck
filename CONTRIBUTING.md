# Contributing

Thank you for helping. Lotcheck handles numbers people base risk decisions on, so the rules are strict.

## Run the tests and the build

You need Node 22 or newer. There is nothing to install.

```
npm test                          # unit, property and golden tests
python3 test/golden/reference.py  # second implementation, cross-checks the golden cases
npm run build                     # writes dist/lotcheck.html and dist/SHA256SUMS
```

`npm run check` builds and then tests. CI runs all of the above, then checks that the committed `dist/` matches what the build produces. If you change the source, rebuild and commit `dist/` too.

## Rules

- **Exact arithmetic only, through the rational type.** All maths goes through `Q` in `src/core/rational.js`. Never use JavaScript `Number` arithmetic for a calculation.
- **No dependencies.** Node built-ins only.
- **No network.** No code or test may make a network call. The page must contain no URL that loads anything.
- **Every formula change needs a hand-worked golden case** in `test/golden/cases.json`, with the working written out in plain words. It must also pass the Python cross-check, `python3 test/golden/reference.py`. The cross-check shows that two implementations of the same written rules (`docs/how-it-works.md`) agree on every case. It does not prove that the rules match every broker or firm, so give a source for any case that quotes one.
- **No broker or firm presets** without a source and a date. Rules change, so a preset that cannot show where it came from and when does not go in.
- **Plain language in the page.** Short sentences. No jargon without an explanation. The tool gives no advice or direction and makes no promise about any trade.
- Pages that describe the tool (README and docs) must quote the page's texts exactly.
- Show money you can lose rounded up, and money you have available rounded down.

## Reporting a wrong number

Use the "Wrong number" issue template. Give:

- every input you entered,
- the result Lotcheck showed,
- the figure your platform shows for the same thing.

Do not post account numbers or personal data. For security problems, see SECURITY.md.
