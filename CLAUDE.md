# Handover for Claude

Read this first, then README.md. The code is the source of truth: if this file and the code
disagree, trust the code and say so.

## What it is

A simple UK retirement withdrawal guidance tool: "How much can I take from my pot, and will it
last?" Static site on GitHub Pages (mr-androidwoody/retirement-withdrawal-tool), vanilla JS ES
modules, no build step, no packages.

- `engine/`: pure JavaScript, no DOM or network, runs in the browser and in Node.
- `ui/`, `index.html`, `style.css`: the page.
- `data/config.json`: all settings, search ranges and presets.

### Data

JST Macrohistory R6, built into `data/jst-r6-global-gbp.json` by `tools/build-datasets.py`:
global equities in GBP (GDP-weighted, 16 countries), UK gilts, UK bills, UK CPI, 1950 to 2020.
2021 to 2025 are added by `tools/extend-dataset.py` (dataset version 1.1.0), rebuilding each series by
JST's method from the figures in `tools/recent-sources.json`: MSCI country returns (USD) at BoE
year-end GBP/USD with JST 2020 GDP weights; a 10-year gilt revalued at BoE year-end yields (IUAMNPY);
OECD 3-month interbank as a stand-in for T-bills (BoE IUMAJNB stopped in 2017); ONS CPI D7G7.
Overlap tests are in the extension section of `tools/check-report.md` (shares close; the rebuilt gilt
runs about 1.5% a year below JST over 2011 to 2020, missing roll-down). If `build-datasets.py` is
rerun, run `extend-dataset.py` after it. Woody holds `JSTdatasetR6.xlsx`; it is not in the repo.
Every start year from 1950 is used.

### Retirement length

Any whole number of years from 20 to 45 (`retirementLength` in config.json), typed in, with
quick picks for 25, 30, 35 and 40. Past retirements tested: 57 at 20 years, 52 at 25, 47 at 30,
42 at 35, 37 at 40, 32 at 45. Checked by `lengthError` in `engine/dataset.js`. The plan must
also end by age 110 (`maxEndAge`): `endAgeError` says so in the length hint and on Find, with the
longest length that fits (or that even 20 years runs past 110, from age 92 up).

### Search

Four strategies: Inflation-adjusted (the 4% rule; id `constant-real`, called "Constant real"
before Nov 2026, and older saved names using that wording are still recognised by `shownName`),
Fixed percentage, Guyton-Klinger guardrails, Floor and ceiling. The "4 withdrawal strategies"
link opens a short 2 x 2 overlay that fits without scrolling.
Each is tried at several rates plus a "pinned" rate that pays exactly the income wanted, across
the grid mixes and cash buffers, plus the user's own mix two ways (cash spent first, or kept as
a flexible reserve). A few hundred plans; the page shows the exact count (484 for the defaults).
"Keep my mix" limits the search to the user's mix.

Recommended depends on "If there is room to spare" in step 2 (`priority` in the request,
`recommendFrom` in `engine/search.js`):
- Spend more (default, `spend`): meets needs, never below wanted where possible, then highest
  typical spending.
- Pass on more (`pass-on`): meets needs and pays what you asked for (never cut below wanted, else
  typical spending reaches wanted), then most typically left behind. Same rule as the "Most left
  behind" row, so that row merges with Recommended.
Your-mix rows and the comparison cards follow the same choice.

### Risk and periods

- Risk is a share ("None", "About 1 in 20", "About 1 in 10") turned into a count for the number
  of retirements tested (`engine/periods.js`).
- Start years are ranked once by the user's mix's real return over the first 10 years
  (rank 1 = worst).
- All / Worst 10 / Best 10 choice on both the results page and the option detail. The options
  and the recommendation are always chosen across all starts; the choice only changes which
  starts the figures, status words and run-out limit cover (including the what-if tables).
  The choice carries between the results page and the detail.
- Option detail: Worst case, Middle case and Best case tags on the start-year boxes (strips
  along the bottom of the box), all about how this option did: starts ordered by lowest income
  year (within a pound counts as equal), then what was left; middle is the middle of that order
  (`middleCase`). Tag colours (`--case-worst`, `--case-mid`, accent for best) are indigo, slate and teal,
  stepping dark to bright, and are not status colours. The rank number on each box is the market measure. Plus a "Retired in X"
  strip for the selected year.

### Results page

Heading and request summary, the All / Worst 10 / Best 10 choice, a recommendation box (strategy
name, what it does, the Income / Cash / The rest recipe, key figures), then "Your mix as it is
now", then the other options and how the other approaches compare. When no plan meets the
needs, a single "Nearest misses" list replaces both: the best try of each approach, closest
first.

### Your current mix

Six one-tap presets (`currentMixes` in config.json) plus Custom. Each chip has a small
shares / bonds / cash bar (teal, violet, grey: a deliberate exception to colour-for-status only,
avoiding the status greens, ambers and reds, and stepping dark to light so it reads in
greyscale); a key sits under the chips, and the Custom chip's bar shows the split typed in. Custom takes pound amounts
(default) or percentages, with a switch that converts between them (`ui/mix.js`, tested in
`tests/mix.test.js`). In pounds the split is what counts; if the amounts do not add up to the pot
a warning offers "Use (amount) as my pot". Saves without `mixUnit` are percentages.

### Saved inputs and saved plans

- Inputs: localStorage key `retirement-withdrawal-tool.inputs.v1`. Bump the version if the saved
  format changes.
- Saved plans (`ui/plans.js`, tested in `tests/plans.test.js`): up to 5 named plans in
  `retirement-withdrawal-tool.plans.v1`, each holding the form inputs it was searched with and
  the option's plan object, plus a summary (pot, years, typical spending, starting split).
  "Save this plan" in the option detail (default name like "(pot), floor and ceiling").
  "Your saved plans" on the first page: a panel, closed until clicked ("2 of 5"), holding a
  compact table (one line per figure, cards under 860px) with Plan, Pot, Approach, Mix and
  Typical spending, in your own
  order (move up / down arrows, `movePlan`; new saves go to the top), and View (restores inputs, reruns the search, opens the plan), Edit, inline Rename and a
  two-press Delete. Edit puts the plan's inputs in the form, closes the panel and shows an edit
  bar (`setEditing`); in the option detail, saving then offers "Update (name)" (replaces inputs,
  option and summary in place, same position, `updatePlan`) or "Save as a new plan". Default
  names (`autoName`, or matching the default) refresh on update; typed names stay. Names that repeat the option (older saves) show only the rest
  (`displayName`); stored names are not changed. Option parts come from `planParts` in
  `ui/format.js`. This browser only; no check-ins yet (see ideas).
- Comparing saved plans: a Compare tick column on the left of the table (two or three plans,
  `MAX_COMPARE`), then "Compare these N" opens `view-compare`. Each plan is rerun from its own saved inputs (`requestFromInputs` reads
  them through the form and puts the form back). Rows: what it is, spending, safety, what is
  left; All / Worst 10 / Best 10 uses each plan's own ranking. The best figure gets a tick and
  bold when one plan clearly has it (`bestIndex`; typical spending compares stages weighted by
  length); with two plans a Difference column says the gap in words (hidden on phones). Logic in `ui/compare.js`,
  tested in `tests/compare.test.js`.

### Out of scope (Woody's choice)

Tax, and a yearly results view. Keep it a simple guidance tool, not overcomplicated.

## Conventions (always)

- Never use em dashes, in replies or code. Use hyphens, colons, commas or parentheses.
- In code, write pound and dash characters as \u escapes (£, −).
- No disclaimer wording like "Estimate only" or "Not advice" in the UI. Plain notes on what a
  figure includes or leaves out are fine.
- Ask clarifying questions before giving detailed answers. Propose first, build when Woody
  says so.
- Keep explanations short and plain.
- Pages share a 1180px width. Colour is used only for status (good / warning / bad), always with
  an icon and words.
- Three themes: every colour is a CSS variable in `style.css` (`:root` for Light,
  `:root[data-theme="dark"]` for Dark (charcoal, teal accent), `:root[data-theme="navy"]` for
  Navy (Woody's .wealth palette: navy grounds, violet accent `#a8a3ff`, mint / coral / red
  status, bonds blue in the mix bar)). Never write a fixed colour in CSS or JS; add a variable
  to all three sets. Chart colours go through `style="stroke:var(--x)"`, not SVG colour attributes.
  The Light / Dark / Navy switch is saved under `retirement-withdrawal-tool.theme`; with nothing
  saved (or an old "auto" save) the page follows the device: Light, or Navy on a dark device.
  A small script in `index.html` sets the theme before the page draws.

## How Woody ships changes

- Woody uploads files to GitHub himself. Do not push, even with write access.
- Give him a zip of only the new or changed files, with their folder paths. List any files to
  delete separately (a zip cannot delete). Remind him to press Ctrl+Shift+R after uploading.
- GitHub's web upload skips names starting with a dot (`.github/`, `.nojekyll`). Those have to
  be created or renamed in the GitHub editor, where typing a slash in the filename makes a
  folder.
- After he uploads, pull and check the files match.

## Working on it

- Tests: `node --test` (Node 18+), 119 passing. They also run on GitHub Actions on every push
  (`.github/workflows/test.yml`). Add tests for engine changes.
- If results change on purpose: review `tools/results-report.md` (`node tools/print-results.mjs`),
  then `node tools/print-results.mjs --update-golden`.
- Check UI changes in a real browser (`python3 -m http.server`, plus Playwright with Chrome) at
  desktop and phone widths, and look for horizontal overflow.

## Ideas raised but not built

- Themed periods (e.g. 1970s inflation, post-war boom) or a custom start-year range, as a lens
  rather than driving the search. Note: for a 60/30/10 mix the worst 10 starts are 1965 to 1974,
  so Worst 10 already covers the 1970s.
- A "to age X" entry for the retirement length.
- Check-ins for saved plans: enter today's pot (and price rise since the start) to see where you
  stand against the plan's past runs and this year's income under its rules. Discussed: one
  check-in for all plans, yearly income resets, optional export/import file between devices.
- On the "nothing meets your needs" page, say what would work (e.g. the highest income any plan
  meets). Needs extra searches.
