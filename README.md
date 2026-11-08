# Retirement Withdrawal Tool

How much can I take from my pot, and will it last? A guidance tool that tests ways of drawing a
retirement pot against 22 actual past retirements (30-year retirements starting 1970 to 1991),
and shows the few that meet the income you want and the least you could live on.

Static site for GitHub Pages: plain HTML, CSS and JavaScript modules, no build step.

## Running it

The page loads its data with `fetch`, so open it through a web server rather than as a file:

```
python3 -m http.server 8000
```

then visit http://localhost:8000. On GitHub Pages it works as it is: Settings, Pages, deploy from
the main branch, root folder.

- `index.html`, `style.css`: the page
- `ui/app.js`: the wizard, results and option detail
- `ui/format.js`: plain-English plan names and recipes
- `ui/charts.js`: the income and pot charts (plain SVG, no libraries)

## Historical data

`data/jst-r6-global-gbp.json` holds one row per year from 1950 to 2020:

- **Global equities** in pounds: a GDP-weighted composite of the JST countries, each converted to GBP
  at year-end exchange rates
- **UK gilts** and **UK bills**: actual total returns
- **UK inflation**: year-on-year change in CPI

Source: Jordà-Schularick-Taylor Macrohistory Database, Release 6 (https://www.macrohistory.net/database/),
used under its non-commercial licence with attribution.

### Rebuilding the data

```
pip install openpyxl
python3 tools/build-datasets.py path/to/JSTdatasetR6.xlsx
```

This rewrites the JSON and `tools/check-report.md`, which lists the spot checks, the effect of
converting to pounds, every year's figures, and a known data issue in the US series for 2016 to 2020.
The spreadsheet itself is not kept in the repo.

## Engine

`engine/` is pure JavaScript with no DOM or network access, so the same code runs in the browser
and in Node:

- `dataset.js` validates the data and slices it into rolling retirements
- `profile.js` turns the request into year-by-year wanted, minimum and other income
- `strategies.js` the four withdrawal strategies: constant real, fixed percentage,
  Guyton-Klinger guardrails, floor and ceiling
- `simulate.js` runs one plan through one past retirement, a year at a time
- `metrics.js` measures each run (lowest income, years below wanted, end value, biggest fall)
- `snapshot.js` reads a pasted Portfolio Snapshot
- `search.js` builds the grid of about 440 plans, runs each against every past retirement,
  and picks the four rows: Recommended, Safest income, Highest typical income, Most left behind

Settings, search ranges and presets are in `data/config.json`.

## Tests

```
node --test
```

Requires Node 18 or later. No packages to install.

`tests/golden.test.js` checks the full results for every preset against `tests/golden/presets.json`.
To review the results as tables, or to accept an intended change to the numbers:

```
node tools/print-results.mjs                  writes tools/results-report.md
node tools/print-results.mjs --update-golden  also rewrites the golden file
```

## Cross-check against the old planner

```
node tools/cross-check.mjs ../retirement-income-planner/js/model/simulator.js
```

Runs the same plan through both engines on every 30-year retirement. Withdrawals match exactly;
end values differ only because the old engine takes withdrawals from bonds first and rebalances
afterwards, while this one keeps the stated mix all year. The script proves that by replaying the
old draw order and matching it to the penny.
