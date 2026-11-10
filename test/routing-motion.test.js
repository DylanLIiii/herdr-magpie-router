import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyInfo } from '../mods/magpie-dashboard/routing.js';
import { routeGroups } from '../server/dashboard.js';

test('strategy metadata preserves upstream codes without exposing raw group fields', () => {
  assert.equal(strategyInfo('weight').label, 'By weight');
  assert.equal(strategyInfo('weighted').id, 'weight');
  assert.equal(strategyInfo('rotate').label, 'Round robin');
  assert.equal(strategyInfo('order').label, 'In order');
  assert.equal(strategyInfo('plugin/custom').label, 'plugin/custom');
  const groups = routeGroups({ groups: [{ id: 'g', weights: { 'a/one': 3 }, prompt: 'private', memberInfo: [
    { id: 'a/one', provider: 'a', model: 'one' }, { id: 'b/two', provider: 'b', model: 'two' },
  ] }] });
  assert.deepEqual(groups[0].members.map(member => member.weight), [3, 1]);
  assert.equal(JSON.stringify(groups).includes('private'), false);
});
