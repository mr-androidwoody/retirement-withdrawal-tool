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
Every start year from 1950 is used.

### Retirement length

Any whole number of years from 20 to 45 (`retirementLength` in config.json), typed in, with
quick picks for 25, 30, 35 and 40. Past retirements tested: 52 at 20 years, 47 at 25, 42 at 30,
37 at 35, 32 at 40, 27 at 45. Checked by `lengthError` in `engine/dataset.js`.

### Search

Four strategies: Constant real, Fixed percentage, Guyton-Klinger guardrails, Floor and ceiling.
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
- Option detail: worst-case and best-case tags on the start-year boxes, and a "Retired in X"
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
  table (cards under 860px) with Plan, Pot, Approach, Mix and Typical spending, newest first,
  and View (restores inputs, reruns the search, opens the plan), Load, inline Rename and a
  two-press Delete. Names that repeat the option (older saves) show only the rest
  (`displayName`); stored names are not changed. Option parts come from `planParts` in
  `ui/format.js`. This browser only; no check-ins yet (see ideas).

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
- Light and dark mode: every colour is a CSS variable in `style.css` (`:root` for light,
  `:root[data-theme="dark"]` for dark). Never write a fixed colour in CSS or JS; add a variable
  to both sets. Chart colours go through `style="stroke:var(--x)"`, not SVG colour attributes.
  The Auto / Light / Dark switch is saved under `retirement-withdrawal-tool.theme`, and a small
  script in `index.html` sets the theme before the page draws.

## How Woody ships changes

- Woody uploads files to GitHub himself. Do not push, even with write access.
- Give him a zip of only the new or changed files, with their folder paths. List any files to
  delete separately (a zip cannot delete). Remind him to press Ctrl+Shift+R after uploading.
- GitHub's web upload skips names starting with a dot (`.github/`, `.nojekyll`). Those have to
  be created or renamed in the GitHub editor, where typing a slash in the filename makes a
  folder.
- After he uploads, pull and check the files match.

## Working on it

- Tests: `node --test` (Node 18+), 114 passing. They also run on GitHub Actions on every push
  (`.github/workflows/test.yml`). Add tests for engine changes.
- If results change on purpose: review `tools/results-report.md` (`node tools/print-results.mjs`),
  then `node tools/print-results.mjs --update-golden`.
- Check UI changes in a real browser (`python3 -m http.server`, plus Playwright with Chrome) at
  desktop and phone widths, and look for horizontal overflow.

## Ideas raised but not built

- Themed periods (e.g. 1970s inflation, post-war boom) or a custom start-year range, as a lens
  rather than driving the search. Note: for a 60/30/10 mix the worst 10 starts are 1965 to 1974,
  so Worst 10 already covers the 1970s.
- Extending the data to 2021 to 2025 using MSCI World (GBP). Woody would need to supply the data;
  splicing it onto the GDP-weighted JST series needs care. Mostly helps shorter plans.
- A "to age X" entry for the retirement length.
- Check-ins for saved plans: enter today's pot (and price rise since the start) to see where you
  stand against the plan's past runs and this year's income under its rules. Discussed: one
  check-in for all plans, yearly income resets, optional export/import file between devices.
- On the "nothing meets your needs" page, say what would work (e.g. the highest income any plan
  meets). Needs extra searches.
