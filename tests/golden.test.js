// The full results for every preset must match the saved golden file. If a change to the
// numbers is intended, rerun `node tools/print-results.mjs --update-golden` and review the diff.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runPresets, goldenView } from '../tools/print-results.mjs';

const golden = JSON.parse(readFileSync(new URL('./golden/presets.json', import.meta.url)));

for (const run of runPresets()) {
  test(`preset "${run.preset.label}" matches the golden file`, () => {
    assert.deepEqual(goldenView(run.result), golden[run.preset.id]);
  });
}
