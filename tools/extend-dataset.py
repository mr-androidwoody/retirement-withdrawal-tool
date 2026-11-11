#!/usr/bin/env python3
"""Extend the dataset from 2021 to 2025 by the same method as JST R6.

JST Macrohistory Release 6 ends in 2020. This script keeps every JST row as it is and adds
2021 to 2025 from the figures in tools/recent-sources.json:

  equities   MSCI country index returns (USD) for the 16 JST countries with equity data,
             converted to pounds at year-end GBP/USD and weighted by JST real GDP for 2020
  bonds      a 10-year par gilt bought at the previous year-end yield and revalued at this
             year-end yield (Bank of England IUAMNPY)
  cash       OECD 3-month interbank rate, annual average (stands in for Treasury bills)
  inflation  ONS CPI annual rate (D7G7), annual average, as JST

It also writes an "Extension" section to tools/check-report.md that tests each method on years
JST already covers, so the join can be judged.

Usage (from the repo root, after tools/build-datasets.py if that is rerun):
  pip install openpyxl
  python3 tools/extend-dataset.py path/to/JSTdatasetR6.xlsx

Running it again gives the same result: rows after 2020 are dropped and rebuilt.
"""

import argparse
import hashlib
import json
import math
import os
import sys

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is needed: pip install openpyxl")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO_ROOT, "data", "jst-r6-global-gbp.json")
SOURCES = os.path.join(REPO_ROOT, "tools", "recent-sources.json")
REPORT = os.path.join(REPO_ROOT, "tools", "check-report.md")
JST_LAST = 2020
VERSION = "1.1.0"
MARKER = "## Extension 2021 to 2025"
GILT_YEARS = 10


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_jst(path, isos, first):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    hdr = [str(h) for h in next(rows)]
    need = ["year", "iso", "eq_tr", "bond_tr", "xrusd", "rgdpmad", "pop"]
    missing = [k for k in need if k not in hdr]
    if missing:
        sys.exit(f"Spreadsheet is missing columns: {', '.join(missing)}")
    idx = {k: hdr.index(k) for k in need}
    out = {}
    for r in rows:
        y, iso = r[idx["year"]], r[idx["iso"]]
        if y is None or iso not in isos or y < first or y > JST_LAST:
            continue
        out[(iso, int(y))] = {k: r[i] for k, i in idx.items() if k not in ("year", "iso")}
    return out


def gilt_return(y0, y1, n=GILT_YEARS):
    """Par bond with coupon y0, revalued a year later as an (n-1)-year bond at yield y1."""
    m = n - 1
    price = sum(y0 / (1 + y1) ** k for k in range(1, m + 1)) + 1 / (1 + y1) ** m
    return y0 + price - 1


def pct(x, places=1):
    return f"{x * 100:.{places}f}%"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("xlsx", help="path to JSTdatasetR6.xlsx")
    args = ap.parse_args()

    src = json.load(open(SOURCES, encoding="utf-8"))
    ds = json.load(open(DATA, encoding="utf-8"))
    if ds["build"]["sourceSha256"] != sha256(args.xlsx):
        sys.exit("This spreadsheet is not the one the dataset was built from (SHA-256 differs).")

    countries = src["equities"]["countries"]
    isos = sorted(countries)
    jst = load_jst(args.xlsx, set(isos), 2010)
    new_years = src["years"]
    fx = {int(k): v for k, v in src["gbpUsdYearEnd"]["values"].items()}
    gy = {int(k): v / 100 for k, v in src["giltYield10yYearEnd"]["values"].items()}
    cash = {int(k): v / 100 for k, v in src["cash"]["values"].items()}
    cpi = {int(k): v / 100 for k, v in src["inflation"]["values"].items()}
    msci = {iso: {int(y): r / 100 for y, r in c["r"].items()} for iso, c in countries.items()}

    def weights(gdp_year):
        w = {i: jst[(i, gdp_year)]["rgdpmad"] * jst[(i, gdp_year)]["pop"] for i in isos}
        t = sum(w.values())
        return {i: v / t for i, v in w.items()}

    w2020 = weights(JST_LAST)

    # New rows.
    problems = []
    rows = []
    for y in new_years:
        move = fx[y - 1] / fx[y]  # pounds per dollar, this year-end over last
        eq = sum(w2020[i] * ((1 + msci[i][y]) * move - 1) for i in isos)
        uk = (1 + msci["GBR"][y]) * move - 1
        row = {
            "year": y,
            "equities": round(eq, 6),
            "bonds": round(gilt_return(gy[y - 1], gy[y]), 6),
            "cash": round(cash[y], 6),
            "inflation": round(cpi[y], 6),
            "ukEquities": round(uk, 6),
            "equitiesCountries": len(isos),
        }
        for k in ("equities", "bonds", "cash", "inflation"):
            if not math.isfinite(row[k]) or abs(row[k]) > 1:
                problems.append(f"{y}: {k} looks wrong ({row[k]})")
        rows.append(row)
    if problems:
        sys.exit("Checks failed:\n" + "\n".join(problems))

    # Overlap tests on years JST covers.
    eq_rows = []
    jt = mt = 1.0
    for y in range(2012, JST_LAST + 1):
        w = weights(y - 1)
        gbp_move = jst[("GBR", y)]["xrusd"] / jst[("GBR", y - 1)]["xrusd"]
        jr = mr = 0.0
        for i in isos:
            now, prev = jst[(i, y)], jst[(i, y - 1)]
            jr += w[i] * ((1 + now["eq_tr"]) * (prev["xrusd"] / now["xrusd"]) * gbp_move - 1)
            mr += w[i] * ((1 + msci[i][y]) * gbp_move - 1)
        jt *= 1 + jr
        mt *= 1 + mr
        eq_rows.append((y, jr, mr))
    bd_rows = []
    jb = bb = 1.0
    for y in range(2011, JST_LAST + 1):
        actual = jst[("GBR", y)]["bond_tr"]
        built = gilt_return(gy[y - 1], gy[y])
        jb *= 1 + actual
        bb *= 1 + built
        bd_rows.append((y, actual, built))

    # Write the dataset: JST rows unchanged, new rows appended.
    ds["years"] = [r for r in ds["years"] if r["year"] <= JST_LAST] + rows
    ds["version"] = VERSION
    ds["label"] = "Global equities (GBP), UK gilts, UK cash, UK CPI, 1950 to 2025"
    ds["extension"] = {
        "years": [new_years[0], new_years[-1]],
        "script": "tools/extend-dataset.py",
        "sources": "tools/recent-sources.json",
        "equities": src["equities"]["method"],
        "bonds": src["bonds"]["method"],
        "cash": src["cash"]["method"],
        "inflation": src["inflation"]["method"],
        "extras": "ukEquities is MSCI United Kingdom in pounds; equitiesLocalCurrency is not given for these years.",
    }
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(ds, f, indent=1, ensure_ascii=False)
        f.write("\n")

    # Report section.
    top = sorted(w2020.items(), key=lambda kv: -kv[1])[:5]
    lines = [
        MARKER,
        "",
        "JST R6 ends in 2020. Rows for 2021 to 2025 are added by `tools/extend-dataset.py` from the",
        "figures in `tools/recent-sources.json`, rebuilding each JST series by the same method. JST rows",
        "are not changed.",
        "",
        f"- Shares: {src['equities']['method']} Weights: " + ", ".join(f"{k} {v * 100:.1f}%" for k, v in top) + ".",
        f"- Gilts: {src['bonds']['method']}",
        f"- Cash: {src['cash']['method']}",
        f"- Inflation: {src['inflation']['method']} Matches JST to the decimal for 2017 to 2020.",
        "- GBP/USD: " + src["gbpUsdYearEnd"]["note"],
        "",
        "### New rows",
        "",
        "| Year | Global equities (GBP) | UK gilts | UK cash | UK CPI | UK equities |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for r in rows:
        lines.append(f"| {r['year']} | {pct(r['equities'])} | {pct(r['bonds'])} | {pct(r['cash'], 2)} | "
                     f"{pct(r['inflation'])} | {pct(r['ukEquities'])} |")
    lines += [
        "",
        "### Overlap test: shares",
        "",
        "The same 16 countries and JST GDP weights, with JST's own country returns against MSCI's.",
        "",
        "| Year | JST composite | Rebuilt from MSCI | Difference |",
        "| --- | --- | --- | --- |",
    ]
    for y, jr, mr in eq_rows:
        lines.append(f"| {y} | {pct(jr)} | {pct(mr)} | {(mr - jr) * 100:+.1f} pts |")
    lines += [
        f"| 2012 to 2020 | {pct(jt - 1)} | {pct(mt - 1)} | |",
        "",
        "Single years differ most in 2018 and 2019, where JST's US returns look like annual averages",
        "(see the known data issue above). Outside the US, MSCI runs about 1% a year below JST (large and",
        "mid caps only, and some figures are after withholding tax).",
        "",
        "### Overlap test: gilts",
        "",
        "| Year | JST gilts | Rebuilt 10-year gilt |",
        "| --- | --- | --- |",
    ]
    for y, a, b in bd_rows:
        lines.append(f"| {y} | {pct(a)} | {pct(b)} |")
    lines += [
        f"| 2011 to 2020 | {pct(jb - 1)} | {pct(bb - 1)} |",
        "",
        "The rebuilt gilt follows JST year by year but leaves out the gain from rolling down an upward",
        "sloping yield curve, which was steep in 2011 to 2020. The curve was flat or inverted for much of",
        "2022 to 2024, so the effect on the new years is smaller. Longer maturities fit the single years",
        "worse.",
        "",
        "### Cash",
        "",
        "JST's UK cash return is the annual average of the Bank of England 3-month Treasury bill rate",
        "(IUMAJNB): 0.50% in 2010, 0.48% in 2011 and 0.45% in 2015 against JST's 0.50%, 0.48% and 0.44%.",
        "That series stopped in June 2017, so the OECD 3-month interbank rate stands in. It runs a little",
        "above Treasury bills.",
        "",
    ]
    report = open(REPORT, encoding="utf-8").read()
    if MARKER in report:
        report = report[: report.index(MARKER)].rstrip("\n") + "\n"
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write(report.rstrip("\n") + "\n\n" + "\n".join(lines))

    print(f"Added {new_years[0]} to {new_years[-1]}; dataset version {VERSION}.")
    for r in rows:
        print(f"  {r['year']}: equities {pct(r['equities'])}, bonds {pct(r['bonds'])}, "
              f"cash {pct(r['cash'], 2)}, inflation {pct(r['inflation'])}")


if __name__ == "__main__":
    main()
