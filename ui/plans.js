// Saved plans: up to MAX_PLANS named plans, each holding the form inputs it was made from and
// the chosen option. Kept in this browser (localStorage). Pure functions apart from the two
// storage helpers, which take the storage object so tests can pass a stand-in.

export const PLANS_KEY = 'retirement-withdrawal-tool.plans.v1';
export const MAX_PLANS = 5;
export const MAX_NAME = 90;

/** Plans from stored text; anything unreadable or malformed is dropped. */
export function parsePlans(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string'
      && p.plan && typeof p.plan.strategy === 'string' && p.inputs && p.inputs.fields).slice(0, MAX_PLANS);
  } catch { return []; }
}

export function loadPlans(storage) {
  try { return parsePlans(storage.getItem(PLANS_KEY)); } catch { return []; }
}

/** Returns true if saved. */
export function storePlans(storage, list) {
  try { storage.setItem(PLANS_KEY, JSON.stringify(list)); return true; } catch { return false; }
}

/** A tidy name: trimmed, single spaces, at most MAX_NAME characters, or the fallback. */
export function cleanName(name, fallback) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return n || fallback;
}

/**
 * Add a plan to the front of the list. Returns { list, entry } or { list, error } with a plain
 * message when the list is full. `now` is a Date; `id` defaults to one made from the time.
 */
export function addPlan(list, { name, inputs, plan, summary }, now = new Date(), id = null) {
  if (list.length >= MAX_PLANS) {
    return { list, error: `You have ${MAX_PLANS} saved plans, the most it keeps. Delete one on the first page to save this.` };
  }
  const entry = {
    id: id || `p${now.getTime().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: cleanName(name, 'My plan'),
    savedAt: now.toISOString(),
    inputs,
    plan,
    summary: summary || {},
  };
  return { list: [entry, ...list], entry };
}

export const removePlan = (list, id) => list.filter((p) => p.id !== id);
export const findPlan = (list, id) => list.find((p) => p.id === id) || null;

/** Give a saved plan a new name (tidied as cleanName does; a blank name keeps the old one). */
export function renamePlan(list, id, name) {
  return list.map((p) => (p.id === id ? { ...p, name: cleanName(name, p.name) } : p));
}

/** A pot in a few characters: \u00a31.5m, \u00a31m, \u00a3850k. */
export function shortPot(x) {
  if (!(x > 0)) return '';
  if (x >= 1e6) return `\u00a3${+(x / 1e6).toFixed(1)}m`;
  return `\u00a3${Math.round(x / 1000)}k`;
}

/** The default name for a new save: pot and approach, e.g. "\u00a31.5m, floor and ceiling". */
export const defaultName = (pot, approach) => [shortPot(pot), approach.toLowerCase()].filter(Boolean).join(', ');

/**
 * The name to show in the table. The table has columns for the option, so a name that repeats
 * the option's full description (older saves did) shows only the rest. The stored name is not
 * changed. Falls back to `fallback` if nothing is left.
 */
export function displayName(name, optionName, fallback) {
  if (!optionName || !name.includes(optionName)) return name;
  const rest = name.replace(optionName, '').replace(/^[\s\-\u2013:,\u00b7]+|[\s\-\u2013:,\u00b7]+$/g, '');
  return rest || fallback;
}
