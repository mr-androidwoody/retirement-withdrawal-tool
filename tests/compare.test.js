import { test } from 'node:test';
import assert from 'node:assert/strict';
import { betterSide, diffText } from '../ui/compare.js';

test('the better side depends on whether high or low is better', () => {
  assert.equal(betterSide(90000, 80000, 'high'), 'a');
  assert.equal(betterSide(90000, 80000, 'low'), 'b');
  assert.equal(betterSide(2, 0, 'low'), 'b');
  assert.equal(betterSide(5, 5, 'high'), null);
  assert.equal(betterSide(90050, 90000, 'high', 100), null);
  assert.equal(betterSide(NaN, 1, 'high'), null);
  assert.equal(betterSide(1, 2, null), null);
});

test('differences are said in words, naming the plan', () => {
  const labels = ['A', 'B'];
  assert.equal(diffText(90000, 77600, 'money', { labels }), '£12,400 more a year in A');
  assert.equal(diffText(8.6e6, 11e6, 'big', { labels }), '£2.4m more in B');
  assert.equal(diffText(450000, 200000, 'big', { labels }), '£250,000 more in A');
  assert.equal(diffText(3, 1, 'count', { labels }), '2 fewer in B');
  assert.equal(diffText(0.37, 0.32, 'points', { labels }), '5 points smaller in B');
  assert.equal(diffText(30, 35, 'years', { labels }), '5 years longer in B');
  assert.equal(diffText(1, 0, 'years', { labels }), '1 year longer in A');
  assert.equal(diffText(60000, 60040, 'money', { labels, tolerance: 100 }), 'Same');
  assert.equal(diffText(NaN, 1, 'money'), '');
});
