// Year-by-year income needs in today's money, built from the request.

/**
 * Returns arrays of length `years` (index 0 = retirement year 1), all in real (today's) pounds:
 *   wanted[t], minimum[t]  total household income wanted and the least that will do
 *   other[t]               guaranteed income (State Pension etc.) in force that year
 */
export function buildProfile(request) {
  const n = request.years;
  const change = request.incomeChange || null;
  const wanted = [];
  const minimum = [];
  const other = [];
  for (let t = 0; t < n; t += 1) {
    const year = t + 1;
    const changed = change && year >= change.fromYear;
    wanted.push(changed ? change.wanted : request.wanted);
    minimum.push(changed ? change.minimum : request.minimum);
    other.push((request.otherIncome || []).reduce(
      (sum, inc) => sum + (year >= (inc.fromYear || 1) ? inc.amount : 0), 0));
  }
  return { wanted, minimum, other };
}
