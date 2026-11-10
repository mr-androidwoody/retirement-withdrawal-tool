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
