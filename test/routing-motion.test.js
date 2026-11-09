import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RouteSignal, routeEvents, routeNodes, strategyInfo, rowY } from '../mods/magpie-dashboard/routing.js';
import { routeGroups } from '../server/dashboard.js';

const now = 1800000000000;
const group = { id: 'coding', ref: 'group/coding', strategy: 'weight', members: [
  { id: 'a/one', provider: 'a', model: 'one', weight: 3, enabled: true, ready: true },
  { id: 'b/two', provider: 'b', model: 'two', weight: 1, enabled: true, ready: true },
] };
const request = (id, provider = 'a', model = 'one', status = 'success') => ({ id, group: 'coding', requestedModel: 'group/coding',
  timestamp: new Date(now).toISOString(), provider, model, status, durationMs: 30, attempts: [] });
function clock() {
  let time = 0, notifications = 0;
  const scheduled = [];
  const context = () => ({ notify() { notifications++; }, timer: { after(delay, callback) { scheduled.push({ at: time + delay, callback }); } } });
  return { cx: context(), advance(until) {
    scheduled.sort((a, b) => a.at - b.at);
    while (scheduled[0]?.at <= until) {
      const task = scheduled.shift(); time = task.at; task.callback(context());
      scheduled.sort((a, b) => a.at - b.at);
    }
    time = until;
  }, notifications: () => notifications };
}

test('strategy codes and configured weights are preserved without exposing raw group fields', () => {
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

test('route events keep real fallback order and exclude other groups and unknown targets', () => {
  const fallback = { ...request('1'), attempts: [{ provider: 'a', model: 'one', status: 'error' }, { provider: 'b', model: 'two', status: 'success' }] };
  const events = routeEvents(group, [fallback, { ...request('2'), group: 'other', requestedModel: 'group/other' }, { ...request('3'), provider: '' }]);
  assert.deepEqual(events.map(event => [event.model, event.status, event.fallback]), [['one', 'error', false], ['two', 'success', true]]);
  const nodes = routeNodes({ ...group, members: [...group.members, { provider: 'group', model: 'nested', group: true }] }, events);
  assert.equal(nodes.nodes.length, 2);
  assert.deepEqual(nodes.nodes.map(node => node.weight), [3, 1]);
});

test('flat display bounds node count, includes observed targets, and never assigns them invented weights', () => {
  const g = { ...group, members: Array.from({ length: 8 }, (_, i) => ({ provider: 'p', model: String(i), weight: 1 })) };
  const events = [{ provider: 'actual', model: 'served', status: 'success' }];
  const result = routeNodes(g, events);
  assert.equal(result.all, 9);
  assert.equal(result.nodes.length, 4);
  const target = result.nodes.find(node => node.provider === 'actual');
  assert.equal(target.observed, true);
  assert.equal(target.weight, undefined);
});

test('initial history is static; new observations travel down the rail then into their destination', () => {
  const c = clock(), signal = new RouteSignal();
  signal.sync(group, [request('old')], 'live', c.cx, { now });
  assert.equal(signal.moving, false, 'loading old history never fabricates live traffic');
  signal.sync(group, [request('new', 'b', 'two'), request('old')], 'live', c.cx, { now });
  assert.equal(signal.label, 'New observations');
  assert.equal(signal.x, 6); assert.equal(signal.y, 8);
  c.advance(40);
  assert.equal(signal.x, 6); assert.equal(signal.y, rowY(1));
  c.advance(280); assert.equal(signal.x, 30);
  c.advance(460); assert.equal(signal.phase, 'arrived');
  c.advance(1080); assert.equal(signal.moving, false);
  signal.sync(group, [request('new', 'b', 'two'), request('old')], 'live', c.cx, { now });
  assert.equal(signal.moving, false, 'unchanged polling snapshots do not replay');
});

test('history replay is labelled, preserves failed-then-successful attempts and settles', () => {
  const c = clock(), signal = new RouteSignal();
  signal.sync(group, [{ ...request('fallback'), attempts: [
    { provider: 'a', model: 'one', status: 'error' }, { provider: 'b', model: 'two', status: 'success' },
  ] }], 'live', c.cx, { now });
  signal.replay(c.cx);
  assert.equal(signal.label, 'History replay');
  assert.equal(signal.current.status, 'error');
  c.advance(1080);
  assert.equal(signal.current.status, 'success');
  assert.equal(signal.current.fallback, true);
  c.advance(2160);
  assert.equal(signal.moving, false);
  assert.equal(signal.label, 'History replay · finished');
});

test('hidden, paused and reduced-motion cases cancel scheduled animation without keeping an old context', () => {
  let visible = true;
  const c = clock(), signal = new RouteSignal(() => visible);
  signal.sync(group, [request('old')], 'live', c.cx, { now });
  signal.replay(c.cx); visible = false; c.advance(40);
  assert.equal(signal.moving, false);
  const notices = c.notifications(); c.advance(5000);
  assert.equal(c.notifications(), notices, 'cancelled phases cannot keep notifying a hidden panel');
  signal.sync(group, [request('next')], 'live', c.cx, { now, animate: false });
  assert.equal(signal.moving, false);
  signal.stop();
});

test('switching group cancels an old trajectory; late history does not animate as live traffic', () => {
  const c = clock(), signal = new RouteSignal();
  signal.sync(group, [request('one')], 'live', c.cx, { now });
  signal.replay(c.cx);
  signal.sync({ ...group, id: 'another', ref: 'group/another' }, [], 'live', c.cx, { now, animate: false });
  c.advance(3000);
  assert.equal(signal.current, null);
  signal.sync(group, [request('one')], 'live', c.cx, { now });
  signal.sync(group, [{ ...request('ancient'), timestamp: new Date(now - 86400000).toISOString() }, request('one')], 'live', c.cx, { now });
  assert.equal(signal.moving, false);
});
