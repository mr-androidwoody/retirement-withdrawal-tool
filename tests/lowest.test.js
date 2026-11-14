import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lowestPot, runSearch, currentFromMix } from '../engine/search.js';

const dataset = JSON.parse(readFileSync(new URL('../data/jst-r6-global-gbp.json', import.meta.url)));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url)));
const preset = (id) => ({ ...config.defaults, ...config.presets.find((p) => p.id === id).values });
const mix = { equities: 0.6, bonds: 0.3, cash: 0.1 };

// What the search itself says, keeping the mix: does any option pay what you want with this pot?
const meets = (request, pot) => runSearch({ dataset, config, request: { ...request, pot }, current: currentFromMix(pot, mix), keepMix: true })
  .results.some((r) => r.status === 'meets-both');

test('lowest pot: a whole number of steps that pays what you want, with one step less not', () => {
  const request = preset('typical');
  const r = lowestPot({ dataset, config, request, mix });
  assert.equal(r.found, true);
  assert.equal(r.pot % 5000, 0);
  assert.ok(meets(request, r.pot), 'the pot found works');
  assert.ok(!meets(request, r.pot - 5000), 'one step less does not');
  assert.ok(r.pot <= request.pot, 'the default pot is enough');
});

test('lowest pot: found from below as well as above the pot asked about', () => {
  const request = preset('typical');
  const fromAbove = lowestPot({ dataset, config, request: { ...request, pot: 2_000_000 }, mix });
  const fromBelow = lowestPot({ dataset, config, request: { ...request, pot: 50_000 }, mix });
  const noPot = lowestPot({ dataset, config, request: { ...request, pot: 0 }, mix });
  assert.equal(fromAbove.pot, fromBelow.pot);
  assert.equal(noPot.pot, fromBelow.pot);
});

test('lowest pot: needing more than any pot up to the limit says so', () => {
  const request = preset('typical');
  const r = lowestPot({ dataset, config, request, mix, maxPot: 100_000 });
  assert.deepEqual([r.found, r.upTo], [false, 100_000]);
});
