# Dataset check report

Dataset `jst-r6-global-gbp` version 1.0.0, built 2026-11-08.
Source file SHA-256: `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d`.

Result: **all checks passed**.

## Spot checks against the spreadsheet (GBR rows)

| Year | Field | Expected | In spreadsheet | OK |
| --- | --- | --- | --- | --- |
| 1974 | `eq_tr` | -0.5020 | -0.501952 | yes |
| 1975 | `eq_tr` | 1.4961 | 1.496069 | yes |
| 2008 | `eq_tr` | -0.2975 | -0.297511 | yes |
| 1982 | `bond_tr` | 0.5352 | 0.535222 | yes |
| 1980 | `bill_rate` | 0.1512 | 0.151200 | yes |

## Currency effect: global equities in local currencies vs in GBP

Years where the pound moved sharply. The GBP column is what the tool uses.

| Year | Local currencies | In GBP | Difference |
| --- | --- | --- | --- |
| 1976 | 9.7% | 28.4% | +18.6 pts |
| 1985 | 38.0% | 24.8% | -13.2 pts |
| 1992 | 3.0% | 20.9% | +17.9 pts |
| 2008 | -38.1% | -15.2% | +22.9 pts |
| 2016 | 4.5% | 23.4% | +18.9 pts |

## GDP weights (largest five)

- 1969: USA 43.7%, Japan 11.9%, Germany 8.6%, UK 8.4%, France 7.7%
- 2020: USA 47.2%, Japan 12.4%, Germany 8.1%, UK 7.1%, France 6.5%

## Every year the tool uses

Annual total returns and CPI inflation. UK equities are shown for comparison only.

| Year | Global equities (GBP) | UK gilts | UK bills | UK CPI | UK equities | Countries |
| --- | --- | --- | --- | --- | --- | --- |
| 1969 | 4.1% | -0.2% | 7.6% | 5.2% | -11.9% | 16 |
| 1970 | -1.6% | 3.5% | 7.0% | 6.5% | -3.5% | 16 |
| 1971 | 10.8% | 26.9% | 5.6% | 9.4% | 46.6% | 16 |
| 1972 | 39.1% | -4.1% | 5.5% | 7.2% | 16.4% | 16 |
| 1973 | 2.4% | -8.8% | 9.4% | 9.3% | -28.0% | 16 |
| 1974 | -21.9% | -15.8% | 11.4% | 15.7% | -50.2% | 16 |
| 1975 | 51.2% | 36.1% | 10.2% | 22.7% | 149.6% | 16 |
| 1976 | 28.4% | 13.9% | 11.2% | 15.7% | 2.3% | 16 |
| 1977 | -5.1% | 45.6% | 7.7% | 14.9% | 48.6% | 16 |
| 1978 | 16.2% | -2.6% | 8.5% | 7.5% | 8.7% | 16 |
| 1979 | 1.7% | 4.2% | 13.0% | 11.4% | 11.5% | 16 |
| 1980 | 15.4% | 19.1% | 15.1% | 15.2% | 34.8% | 16 |
| 1981 | 19.2% | 10.0% | 13.0% | 11.8% | 13.6% | 16 |
| 1982 | 24.2% | 53.5% | 11.4% | 8.1% | 28.5% | 16 |
| 1983 | 36.2% | 7.8% | 9.6% | 4.9% | 28.8% | 16 |
| 1984 | 32.4% | 3.8% | 9.3% | 4.3% | 31.6% | 16 |
| 1985 | 24.8% | 19.9% | 11.6% | 4.9% | 20.1% | 16 |
| 1986 | 45.4% | 12.5% | 10.3% | 3.3% | 27.2% | 16 |
| 1987 | -7.2% | 17.9% | 9.2% | 3.2% | 8.7% | 16 |
| 1988 | 21.6% | 6.9% | 9.8% | 3.8% | 11.5% | 16 |
| 1989 | 40.3% | 8.2% | 13.3% | 5.2% | 35.5% | 16 |
| 1990 | -20.2% | 8.2% | 14.1% | 7.0% | -9.6% | 16 |
| 1991 | 15.6% | 18.5% | 10.8% | 7.5% | 20.8% | 16 |
| 1992 | 20.9% | 20.0% | 8.9% | 4.3% | 19.9% | 16 |
| 1993 | 24.2% | 22.8% | 5.2% | 2.5% | 27.5% | 16 |
| 1994 | 0.1% | -10.4% | 5.2% | 2.0% | -5.9% | 16 |
| 1995 | 21.1% | 17.6% | 6.3% | 2.7% | 23.0% | 16 |
| 1996 | 8.7% | 7.8% | 5.8% | 2.4% | 15.8% | 16 |
| 1997 | 22.1% | 16.8% | 6.5% | 1.8% | 23.6% | 16 |
| 1998 | 22.2% | 21.2% | 6.8% | 1.6% | 13.7% | 16 |
| 1999 | 25.8% | -4.1% | 5.0% | 1.3% | 23.8% | 16 |
| 2000 | 1.1% | 9.8% | 5.8% | 0.8% | -5.9% | 16 |
| 2001 | -15.8% | 3.0% | 4.8% | 1.2% | -13.2% | 16 |
| 2002 | -24.4% | 10.2% | 3.9% | 1.3% | -22.3% | 16 |
| 2003 | 18.2% | 2.1% | 3.6% | 1.4% | 20.2% | 16 |
| 2004 | 11.3% | 6.6% | 4.4% | 1.3% | 12.6% | 16 |
| 2005 | 20.8% | 8.5% | 4.5% | 2.1% | 21.6% | 16 |
| 2006 | 10.3% | -0.5% | 4.7% | 2.3% | 16.4% | 16 |
| 2007 | 9.3% | 6.2% | 5.5% | 2.3% | 5.1% | 16 |
| 2008 | -15.2% | 16.0% | 4.3% | 3.6% | -29.8% | 16 |
| 2009 | 13.8% | -1.5% | 0.5% | 2.2% | 29.0% | 16 |
| 2010 | 13.3% | 10.1% | 0.5% | 3.3% | 14.2% | 16 |
| 2011 | -3.9% | 18.4% | 0.5% | 4.5% | -3.4% | 16 |
| 2012 | 12.1% | 3.8% | 0.3% | 2.8% | 12.1% | 16 |
| 2013 | 24.7% | -6.1% | 0.3% | 2.6% | 20.5% | 16 |
| 2014 | 9.9% | 15.6% | 0.4% | 1.5% | 1.2% | 16 |
| 2015 | 7.2% | 0.8% | 0.4% | 0.0% | 1.1% | 16 |
| 2016 | 23.4% | 7.1% | 0.2% | 0.7% | 15.4% | 16 |
| 2017 | 13.0% | 3.7% | 0.4% | 2.7% | 14.1% | 16 |
| 2018 | 5.1% | 2.2% | 0.7% | 2.5% | -9.5% | 16 |
| 2019 | 11.8% | 5.7% | 0.7% | 1.8% | 18.4% | 16 |
| 2020 | 8.7% | 5.8% | 0.0% | 0.9% | -9.4% | 16 |

## Averages, 1969 to 2020 (compound, a year)

| Series | Nominal | Real (after UK CPI) |
| --- | --- | --- |
| Global equities (GBP) | 11.7% | 6.4% |
| UK gilts | 9.0% | 3.8% |
| UK bills | 6.3% | 1.2% |
| UK equities | 10.4% | 5.2% |
| UK CPI | 5.0% | |

## Notes

- Exchange rates (`xrusd`) are year-end rates, so currency moves line up with calendar-year returns.
- Weights are real GDP in the previous year: `rgdpmad` (GDP per person) times `pop`.
- JST's CPI is an annual-average index, so measured inflation lags returns by about six months.
- Countries enter the composite when they have equity, exchange-rate and GDP data in both years.
- JST has no equity returns for Canada or Ireland, so the composite covers 16 countries.

## Known data issue

JST R6 US equity returns for 2016 to 2020 (`eq_tr`, USA) differ from widely published year-end
S&P 500 total returns: for example 2018 is +14.2% in JST, where the S&P 500 fell about 4%, and
2019 is +8.2% against roughly +31%. They look like annual-average figures. UK figures for the
same years match published FTSE All-Share returns closely. The data is used as published, not
patched from another source. It affects only the last five years of retirements starting 1987
to 1991. The multi-year total is similar, so the effect on outcomes is limited.

## Extension 2021 to 2025

JST R6 ends in 2020. Rows for 2021 to 2025 are added by `tools/extend-dataset.py` from the
figures in `tools/recent-sources.json`, rebuilding each JST series by the same method. JST rows
are not changed.

- Shares: MSCI country index total returns in US dollars for the 16 JST countries with equity data, converted to pounds with the year-end GBP/USD rate and weighted by JST real GDP for 2020 (rgdpmad x pop), held for every new year. Weights: USA 48.0%, JPN 12.5%, DEU 8.1%, GBR 6.7%, FRA 6.3%.
- Gilts: Return on a 10-year par gilt bought at the previous year-end yield and revalued at this year-end yield as a 9-year bond (coupon plus price change).
- Cash: OECD 3-month interbank rate, annual average (FRED series IR3TIB01GBA156N), standing in for the 3-month Treasury bill rate (Bank of England series IUMAJNB stopped in June 2017).
- Inflation: ONS CPI annual rate, series D7G7 (MM23), annual average, release of 21 October 2026. Matches JST to the decimal for 2017 to 2020.
- GBP/USD: GBP/USD at year end. 2020-2023 and 2025: Bank of England reference rate on the last business day (via poundsterlinglive.com BoE pages). 2024: market mid on 31 Dec (BoE page not reachable).

### New rows

| Year | Global equities (GBP) | UK gilts | UK cash | UK CPI | UK equities |
| --- | --- | --- | --- | --- | --- |
| 2021 | 19.7% | -6.3% | 0.09% | 2.6% | 20.0% |
| 2022 | -7.0% | -19.9% | 2.00% | 9.1% | 6.5% |
| 2023 | 17.0% | 5.2% | 4.95% | 7.3% | 7.8% |
| 2024 | 16.4% | -2.9% | 5.00% | 2.5% | 9.3% |
| 2025 | 18.2% | 4.9% | 4.12% | 3.4% | 25.9% |

### Overlap test: shares

The same 16 countries and JST GDP weights, with JST's own country returns against MSCI's.

| Year | JST composite | Rebuilt from MSCI | Difference |
| --- | --- | --- | --- |
| 2012 | 12.1% | 14.0% | +1.9 pts |
| 2013 | 24.7% | 22.9% | -1.8 pts |
| 2014 | 9.9% | 7.9% | -2.0 pts |
| 2015 | 7.2% | 5.8% | -1.5 pts |
| 2016 | 23.4% | 27.4% | +4.0 pts |
| 2017 | 13.0% | 12.5% | -0.4 pts |
| 2018 | 5.1% | -4.6% | -9.7 pts |
| 2019 | 11.8% | 22.0% | +10.3 pts |
| 2020 | 8.7% | 11.0% | +2.3 pts |
| 2012 to 2020 | 193.2% | 196.2% | |

Single years differ most in 2018 and 2019, where JST's US returns look like annual averages
(see the known data issue above). Outside the US, MSCI runs about 1% a year below JST (large and
mid caps only, and some figures are after withholding tax).

### Overlap test: gilts

| Year | JST gilts | Rebuilt 10-year gilt |
| --- | --- | --- |
| 2011 | 18.4% | 15.4% |
| 2012 | 3.8% | 3.9% |
| 2013 | -6.1% | -7.6% |
| 2014 | 15.6% | 13.2% |
| 2015 | 0.8% | 0.1% |
| 2016 | 7.1% | 8.3% |
| 2017 | 3.7% | 1.5% |
| 2018 | 2.2% | 0.6% |
| 2019 | 5.7% | 5.0% |
| 2020 | 5.8% | 6.8% |
| 2011 to 2020 | 70.8% | 55.6% |

The rebuilt gilt follows JST year by year but leaves out the gain from rolling down an upward
sloping yield curve, which was steep in 2011 to 2020. The curve was flat or inverted for much of
2022 to 2024, so the effect on the new years is smaller. Longer maturities fit the single years
worse.

### Cash

JST's UK cash return is the annual average of the Bank of England 3-month Treasury bill rate
(IUMAJNB): 0.50% in 2010, 0.48% in 2011 and 0.45% in 2015 against JST's 0.50%, 0.48% and 0.44%.
That series stopped in June 2017, so the OECD 3-month interbank rate stands in. It runs a little
above Treasury bills.
