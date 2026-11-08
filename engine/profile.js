// Year-by-year income needs in today's money, built from the request.

/**
 * Returns arrays of length `years` (index 0 = retirement year 1), all in real (today's) pounds:
 *   wanted[t], minimum[t]  total household income wanted and the least that will do
 *   other[t]               all income from outside the pot in force that year: guaranteed
 *                          income (State Pension etc.) and earnings
 *   earned[t]              the earnings part of other[t]: income from work that stops
 *
 * Each item of request.otherIncome is { amount, fromYear?, toYear?, kind? }, where toYear is
 * the last retirement year it is received (none = for life) and kind 'earned' marks earnings.
 */
export function buildProfile(request) {
  const n = request.years;
  const change = request.incomeChange || null;
  const items = request.otherIncome || [];
  const wanted = [];
  const minimum = [];
  const other = [];
  const earned = [];
  const inForce = (inc, year) => year >= (inc.fromYear || 1) && (inc.toYear == null || year <= inc.toYear);
  for (let t = 0; t < n; t += 1) {
    const year = t + 1;
    const changed = change && year >= change.fromYear;
    wanted.push(changed ? change.wanted : request.wanted);
    minimum.push(changed ? change.minimum : request.minimum);
    other.push(items.reduce((sum, inc) => sum + (inForce(inc, year) ? inc.amount : 0), 0));
    earned.push(items.reduce((sum, inc) => sum + (inc.kind === 'earned' && inForce(inc, year) ? inc.amount : 0), 0));
  }
  return { wanted, minimum, other, earned };
}
