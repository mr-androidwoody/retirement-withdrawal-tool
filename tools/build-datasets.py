#!/usr/bin/env python3
"""Build the historical dataset for the Retirement Withdrawal Tool.

Reads the JST Macrohistory Database R6 spreadsheet (JSTdatasetR6.xlsx) and writes:

  data/jst-r6-global-gbp.json   one row per year: global equities (GBP), UK gilts,
                                UK bills, UK CPI inflation
  tools/check-report.md         figures and checks to compare against the spreadsheet

Usage (from the repo root):
  pip install openpyxl
  python3 tools/build-datasets.py path/to/JSTdatasetR6.xlsx

Every value is either an actual JST figure or a documented calculation from JST
figures. Nothing is interpolated or filled in. The script stops with an error if
any check fails.
"""

import argparse
import datetime as dt
import hashlib
import json
import math
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is needed: pip install openpyxl")

DATASET_ID = "jst-r6-global-gbp"
DATASET_VERSION = "1.0.0"
FIRST_YEAR = 1950          # first year written to the JSON (inflation needs 1949)
LAST_YEAR = 2020           # last year in JST R6
CHECK_FROM = 1969          # report and strict checks cover the years the tool uses
HOME = "GBR"

# Values reproduced exactly from the spreadsheet (GBR rows), used as spot checks.
SPOT_CHECKS = [
    (1974, "eq_tr", -0.5020),
    (1975, "eq_tr", 1.4961),
    (2008, "eq_tr", -0.2975),
    (1982, "bond_tr", 0.5352),
    (1980, "bill_rate", 0.1512),
]

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def num(v):
    """Return a float, or None for blanks and non-numbers."""
    if v is None or isinstance(v, bool):
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def load(path):
    """Return {(iso, year): {field: value}} and the sorted list of countries."""
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    need = ["year", "iso", "country", "eq_tr", "bond_tr", "bill_rate", "cpi",
            "xrusd", "rgdpmad", "pop"]
    missing = [k for k in need if k not in header]
    if missing:
        sys.exit(f"Spreadsheet is missing columns: {missing}")
    idx = {k: header.index(k) for k in need}
    data, names = {}, {}
    for r in rows:
        year, iso = r[idx["year"]], r[idx["iso"]]
        if year is None or iso is None:
            continue
        year = int(year)
        data[(iso, year)] = {k: num(r[idx[k]]) for k in need if k not in ("year", "iso", "country")}
        names[iso] = r[idx["country"]]
    return data, names


def gbp_equity_composite(data, isos, year):
    """GDP-weighted global equity return in GBP for one year.

    For each country c with data in years t-1 and t:
      r_gbp = (1 + r_local) * (X[c,t-1] / X[c,t]) * (X[GBR,t] / X[GBR,t-1]) - 1
    where X = xrusd (local currency per US dollar, year end).
    Weight = real GDP in t-1 = rgdpmad (per person) * pop.
    Also returns the same composite in local currencies, for the report.
    """
    home_now, home_prev = data.get((HOME, year)), data.get((HOME, year - 1))
    if not home_now or not home_prev or not home_now["xrusd"] or not home_prev["xrusd"]:
        return None
    gbp_move = home_now["xrusd"] / home_prev["xrusd"]
    parts = []
    for iso in isos:
        now, prev = data.get((iso, year)), data.get((iso, year - 1))
        if not now or not prev:
            continue
        r, x1, x0 = now["eq_tr"], now["xrusd"], prev["xrusd"]
        gdp_pc, pop = prev["rgdpmad"], prev["pop"]
        if None in (r, x1, x0, gdp_pc, pop) or x1 <= 0 or x0 <= 0:
            continue
        r_gbp = (1 + r) * (x0 / x1) * gbp_move - 1
        parts.append((iso, gdp_pc * pop, r, r_gbp))
    if not parts:
        return None
    total_w = sum(p[1] for p in parts)
    return {
        "gbp": sum(p[1] * p[3] for p in parts) / total_w,
        "local": sum(p[1] * p[2] for p in parts) / total_w,
        "countries": [p[0] for p in parts],
        "weights": {p[0]: p[1] / total_w for p in parts},
    }


def build(data, isos):
    years, errors = [], []
    for year in range(FIRST_YEAR, LAST_YEAR + 1):
        uk, uk_prev = data.get((HOME, year)), data.get((HOME, year - 1))
        comp = gbp_equity_composite(data, isos, year)
        row_ok = uk and uk_prev and comp and None not in (
            uk["bond_tr"], uk["bill_rate"], uk["cpi"], uk_prev["cpi"])
        if not row_ok:
            errors.append(f"{year}: incomplete data")
            continue
        years.append({
            "year": year,
            "equities": comp["gbp"],
            "bonds": uk["bond_tr"],
            "cash": uk["bill_rate"],
            "inflation": uk["cpi"] / uk_prev["cpi"] - 1,
            "ukEquities": uk["eq_tr"],
            "equitiesLocalCurrency": comp["local"],
            "equitiesCountries": len(comp["countries"]),
            "_weights": comp["weights"],
        })
    return years, errors


def run_checks(years, data):
    problems = []
    by_year = {y["year"]: y for y in years}
    # 1. continuity
    expected = list(range(years[0]["year"], LAST_YEAR + 1)) if years else []
    gaps = [y for y in expected if y not in by_year]
    if gaps:
        problems.append(f"Missing years: {gaps}")
    if not years or years[0]["year"] > CHECK_FROM:
        problems.append(f"Data does not start by {CHECK_FROM}")
    # 2. ranges
    for y in years:
        for k in ("equities", "bonds", "cash"):
            if not -0.9 <= y[k] <= 4.0:
                problems.append(f"{y['year']} {k} out of range: {y[k]:.4f}")
        if not -0.2 <= y["inflation"] <= 0.4:
            problems.append(f"{y['year']} inflation out of range: {y['inflation']:.4f}")
    # 3. spot values
    spot = []
    for year, field, want in SPOT_CHECKS:
        got = data[(HOME, year)][field]
        ok = round(got, 4) == want
        spot.append((year, field, want, got, ok))
        if not ok:
            problems.append(f"Spot check failed: {year} {field} {got} != {want}")
    # 4. UK figures in the output match the raw rows exactly
    for y in years:
        raw = data[(HOME, y["year"])]
        if abs(y["bonds"] - raw["bond_tr"]) > 1e-10 or abs(y["cash"] - raw["bill_rate"]) > 1e-10:
            problems.append(f"{y['year']}: UK figures do not match the spreadsheet")
    # 5. weights sum to one
    for y in years:
        if abs(sum(y["_weights"].values()) - 1) > 1e-9:
            problems.append(f"{y['year']}: weights do not sum to 1")
    return problems, spot


def pct(x, places=1):
    return f"{x * 100:.{places}f}%"


def write_report(path, years, spot, names, src_hash, problems):
    use = [y for y in years if y["year"] >= CHECK_FROM]
    lines = [
        "# Dataset check report",
        "",
        f"Dataset `{DATASET_ID}` version {DATASET_VERSION}, built {dt.date.today().isoformat()}.",
        f"Source file SHA-256: `{src_hash}`.",
        "",
        f"Result: **{'all checks passed' if not problems else 'CHECKS FAILED'}**.",
        "",
        "## Spot checks against the spreadsheet (GBR rows)",
        "",
        "| Year | Field | Expected | In spreadsheet | OK |",
        "| --- | --- | --- | --- | --- |",
    ]
    for year, field, want, got, ok in spot:
        lines.append(f"| {year} | `{field}` | {want:.4f} | {got:.6f} | {'yes' if ok else 'NO'} |")
    lines += [
        "",
        "## Currency effect: global equities in local currencies vs in GBP",
        "",
        "Years where the pound moved sharply. The GBP column is what the tool uses.",
        "",
        "| Year | Local currencies | In GBP | Difference |",
        "| --- | --- | --- | --- |",
    ]
    for y in use:
        if y["year"] in (1976, 1985, 1992, 2008, 2016):
            lines.append(f"| {y['year']} | {pct(y['equitiesLocalCurrency'])} | {pct(y['equities'])} | "
                         f"{(y['equities'] - y['equitiesLocalCurrency']) * 100:+.1f} pts |")
    last = use[-1]
    top = sorted(last["_weights"].items(), key=lambda kv: -kv[1])[:5]
    first = use[0]
    top_first = sorted(first["_weights"].items(), key=lambda kv: -kv[1])[:5]
    lines += [
        "",
        "## GDP weights (largest five)",
        "",
        f"- {first['year']}: " + ", ".join(f"{names[i]} {pct(w)}" for i, w in top_first),
        f"- {last['year']}: " + ", ".join(f"{names[i]} {pct(w)}" for i, w in top),
        "",
        "## Every year the tool uses",
        "",
        "Annual total returns and CPI inflation. UK equities are shown for comparison only.",
        "",
        "| Year | Global equities (GBP) | UK gilts | UK bills | UK CPI | UK equities | Countries |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for y in use:
        lines.append(f"| {y['year']} | {pct(y['equities'])} | {pct(y['bonds'])} | {pct(y['cash'])} | "
                     f"{pct(y['inflation'])} | {pct(y['ukEquities'])} | {y['equitiesCountries']} |")
    n = len(use)
    def cagr(key):
        g = 1.0
        for y in use:
            g *= 1 + y[key]
        return g ** (1 / n) - 1
    infl = cagr("inflation")
    lines += [
        "",
        f"## Averages, {use[0]['year']} to {use[-1]['year']} (compound, a year)",
        "",
        "| Series | Nominal | Real (after UK CPI) |",
        "| --- | --- | --- |",
    ]
    for key, label in (("equities", "Global equities (GBP)"), ("bonds", "UK gilts"),
                       ("cash", "UK bills"), ("ukEquities", "UK equities")):
        c = cagr(key)
        lines.append(f"| {label} | {pct(c)} | {pct((1 + c) / (1 + infl) - 1)} |")
    lines.append(f"| UK CPI | {pct(infl)} | |")
    if problems:
        lines += ["", "## Problems", ""] + [f"- {p}" for p in problems]
    lines += [
        "",
        "## Notes",
        "",
        "- Exchange rates (`xrusd`) are year-end rates, so currency moves line up with calendar-year returns.",
        "- Weights are real GDP in the previous year: `rgdpmad` (GDP per person) times `pop`.",
        "- JST's CPI is an annual-average index, so measured inflation lags returns by about six months.",
        "- Countries enter the composite when they have equity, exchange-rate and GDP data in both years.",
        "- JST has no equity returns for Canada or Ireland, so the composite covers 16 countries.",
        "",
        "## Known data issue",
        "",
        "JST R6 US equity returns for 2016 to 2020 (`eq_tr`, USA) differ from widely published year-end",
        "S&P 500 total returns: for example 2018 is +14.2% in JST, where the S&P 500 fell about 4%, and",
        "2019 is +8.2% against roughly +31%. They look like annual-average figures. UK figures for the",
        "same years match published FTSE All-Share returns closely. The data is used as published, not",
        "patched from another source. It affects only the last five years of retirements starting 1987",
        "to 1991. The multi-year total is similar, so the effect on outcomes is limited.",
        "",
    ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", help="path to JSTdatasetR6.xlsx")
    args = ap.parse_args()

    data, names = load(args.xlsx)
    isos = sorted({iso for iso, _ in data})
    years, build_errors = build(data, isos)
    problems, spot = run_checks(years, data)
    problems = [e for e in build_errors if int(e[:4]) >= CHECK_FROM] + problems
    src_hash = sha256(args.xlsx)

    report_path = os.path.join(REPO_ROOT, "tools", "check-report.md")
    write_report(report_path, years, spot, names, src_hash, problems)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        sys.exit(f"Checks failed; see {report_path}")

    out = {
        "id": DATASET_ID,
        "version": DATASET_VERSION,
        "label": "Global equities (GBP), UK gilts, UK cash, UK CPI",
        "currency": "GBP",
        "source": {
            "name": "Jorda-Schularick-Taylor Macrohistory Database, Release 6",
            "file": "JSTdatasetR6.xlsx",
            "url": "https://www.macrohistory.net/database/",
            "citation": ("Oscar Jorda, Moritz Schularick, and Alan M. Taylor. 2017. Macrofinancial "
                         "History and the New Business Cycle Facts. NBER Macroeconomics Annual 2016, "
                         "volume 31, edited by Martin Eichenbaum and Jonathan A. Parker. Chicago: "
                         "University of Chicago Press."),
            "licence": "Used under the JST licence for non-commercial use, with attribution.",
        },
        "build": {
            "script": "tools/build-datasets.py",
            "sourceSha256": src_hash,
            "builtOn": dt.date.today().isoformat(),
        },
        "assets": {
            "equities": {"label": "Global equities", "method": "GDP-weighted composite of JST countries, each converted to GBP at year-end exchange rates", "fields": ["eq_tr", "xrusd", "rgdpmad", "pop"]},
            "bonds": {"label": "UK gilts", "method": "actual", "fields": ["bond_tr"]},
            "cash": {"label": "UK bills", "method": "actual", "fields": ["bill_rate"]},
        },
        "inflation": {"label": "UK CPI", "method": "year-on-year change in cpi (annual-average index)", "fields": ["cpi"]},
        "extras": {
            "ukEquities": "UK equity total return (eq_tr, GBR), for comparison only",
            "equitiesLocalCurrency": "the same composite before conversion to GBP, for comparison only",
        },
        "years": [
            {k: (round(v, 6) if isinstance(v, float) else v) for k, v in y.items() if not k.startswith("_")}
            for y in years
        ],
    }
    out_path = os.path.join(REPO_ROOT, "data", f"{DATASET_ID}.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print(f"Wrote {out_path} ({len(years)} years, {years[0]['year']} to {years[-1]['year']})")
    print(f"Wrote {report_path}")


if __name__ == "__main__":
    main()
