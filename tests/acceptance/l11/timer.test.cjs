const {test} = require('node:test');
const assert = require('node:assert/strict');
const RS = require('../../../app/sessions.js');

test('Rest timer — timestamp and injected clock keep the correct countdown after a hidden page or locked screen', () => {
  let now = 100000;
  const clock = () => now;
  assert.equal(RS.restRemaining(100000, 60, clock), 60);
  now += 5000;
  assert.equal(RS.restRemaining(100000, 60, clock), 55);
  now += 5000; // no intervening timer callback, as when the page is hidden
  assert.equal(RS.restRemaining(100000, 60, clock), 50);
  now += 50000;
  assert.equal(RS.restRemaining(100000, 60, clock), 0);
  now += 10000;
  assert.equal(RS.restRemaining(100000, 60, clock), 0);
});
