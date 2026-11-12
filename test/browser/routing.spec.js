import { test, expect } from '@playwright/test';
import { demoSnapshot } from '../fixtures/demo.js';
const quietTrace = page => page.route('**/api/routing?*', route => route.fulfill({contentType: 'application/json', body: JSON.stringify({seq: 0, epoch: 'fixture', mine: true, routes: [], ids: []})}));
async function fixture(page) {
  await page.route('**/api/snapshot*', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ ...demoSnapshot(), mode: 'live', source: { label: 'Test fixture', detail: 'Synthetic data supplied only by the test' } }) }));
  await quietTrace(page);
}

test('route inspection, filtering, navigation and export work without Demo or Pause', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixture(page);
  await page.goto('/');
  await expect(page.locator('#metric-requests')).toHaveText('64');
  await expect(page.locator('#source-badge')).toHaveText('实时数据');
  await expect(page.locator('#route-diagram svg')).toBeVisible();
  await page.locator('#status-filter').selectOption('fallback');
  await expect(page.locator('#request-count')).toHaveText('5 条');
  await page.locator('.request-select').first().click();
  await expect(page.locator('#request-detail')).toBeVisible();
  await expect(page.locator('#request-detail')).toContainText('429');
  await expect(page.locator('#route-diagram .attempt')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/magpie-requests-live/);
  await page.locator('#search').fill('no-such-model');
  await expect(page.locator('#requests-empty')).toContainText('没有匹配的请求');
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('#clear-filters').click();
  await expect(page.locator('#request-count')).toHaveText('64 条');
  await expect(page.locator('#pause')).toHaveCount(0);
  await expect(page.locator('#mode')).toHaveCount(0);
  await page.locator('[data-view=groups]').click();
  await expect(page.locator('#groups-section')).toBeVisible();
  await expect(page.locator('.group-item')).toHaveCount(3);
  await page.locator('[data-view=requests]').click();
  await expect(page.locator('#route-section')).toBeHidden();
  expect(errors).toEqual([]);
});

test('failed live mode exposes connection state and never demo values', async ({ page }) => {
  await page.route('**/api/snapshot?mode=live', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ mode: 'live', connection: 'unconfigured', updatedAt: new Date().toISOString(), source: { label: 'Magpie', detail: '请配置 MAGPIE_URL' }, error: '尚未配置数据源', requests: [], groups: [], providers: [] }) }));
  await page.goto('/?mode=live');
  await expect(page.locator('#notice')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('尚未配置数据源');
  await expect(page.locator('#source-badge')).toHaveText('实时数据');
  await expect(page.locator('#metric-requests')).toHaveText('0');
  await expect(page.locator('#connection-label')).toHaveText('尚未配置连接');
  await expect(page.locator('.request-select')).toHaveCount(0);
});

test('upstream strings cannot inject HTML into requests or graph', async ({ page }) => {
  const hostile = '<img src=x onerror="window.injected=true">';
  await page.route('**/api/snapshot*', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mode: 'live', connection: 'connected', updatedAt: new Date().toISOString(), source: { label: 'Magpie', detail: '' }, groups: [], providers: [], requests: [{ id: hostile, timestamp: new Date().toISOString(), group: hostile, requestedModel: hostile, model: hostile, provider: hostile, status: 'success', durationMs: 200, attempts: [] }] }) }));
  await quietTrace(page);
  await page.goto('/?mode=live');
  await expect(page.locator('.request-select')).toHaveCount(1);
  await page.locator('.request-select').click();
  expect(await page.evaluate(() => Boolean(window.injected))).toBe(false);
  await expect(page.locator('#request-rows img')).toHaveCount(0);
  await expect(page.locator('#request-detail')).toContainText(hostile);
});

for (const [name, width, height, query] of [['desktop', 1440, 1000, ''], ['mobile', 390, 844, ''], ['embed', 600, 850, '&embed=1']]) {
  test(`${name} fits viewport and keyboard navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await fixture(page);
    await page.goto(`/?mode=live${query}`);
    await expect(page.locator('#metric-requests')).toHaveText('64');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.locator('#refresh').focus();
    await expect(page.locator('#refresh')).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  });
}

const traceRoute = (id = 'live-1') => ({
  id, timestamp: new Date().toISOString(), group: 'coding', requestedModel: 'auto/coding',
  model: 'gpt-5.4', provider: 'openai', status: 'pending', done: false, fallback: false,
  attempts: [{model: 'gpt-5.4', provider: 'openai', status: 'pending', done: false}]
});
const traceFrame = (seq, routes, extra = {}) => ({seq, epoch: 'owner', mine: true, routes, ids: routes.map(route => route.id), ...extra});
async function liveFixture(page, frame) {
  const snapshot = demoSnapshot();
  snapshot.requests = [traceRoute(), ...snapshot.requests];
  snapshot.mode = 'live'; snapshot.source = {label: 'Test fixture', detail: 'Synthetic data supplied only by the test'};
  await page.route('**/api/snapshot*', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(snapshot)}));
  await page.route('**/api/routing?*', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(frame.current)}));
}

test('live trace flies across the graph, waits for each attempt, retries and returns on completion', async ({page}) => {
  const issues = [];
  page.on('pageerror', error => issues.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /content security policy|refused to apply|refused to execute/i.test(message.text())) issues.push(message.text()); });
  const route = traceRoute();
  const feed = {current: traceFrame(1, [route])};
  await liveFixture(page, feed);
  await page.goto('/');
  await expect(page.locator('#route-active')).toContainText('1 活跃');
  await expect(page.locator('.live-packet-shell')).toHaveCount(1);
  await expect(page.locator('.live-halo.pulse')).toHaveCount(1);
  await expect(page.locator('.live-energy')).toHaveCount(3);
  await page.screenshot({path: '.impeccable/review/desktop-live.png', fullPage: true});
  await expect(page.locator('.route-lane')).toHaveCount(1);
  await page.locator('.route-lane').click();
  await expect(page.locator('#request-detail')).toBeVisible();
  await expect(page.locator('#request-rows tr.selected')).toContainText('gpt-5.4');

  const failed = structuredClone(route);
  failed.attempts[0].done = true; failed.attempts[0].status = 'error';
  feed.current = traceFrame(2, [failed]);
  await expect(page.locator('.route-lane')).toContainText('等待重选');
  await expect(page.locator('.live-packet.recovered')).toHaveCount(1);
  await expect(page.locator('#route-diagram .route-path.attempt')).toHaveCount(2);
  await expect(page.locator('.live-packet-shell')).toHaveAttribute('cx', '240.00');
  await expect(page.locator('.route-lane')).toContainText('等待重选');

  const retry = structuredClone(failed);
  retry.model = 'claude-sonnet-4-6'; retry.provider = 'anthropic'; retry.fallback = true;
  retry.attempts.push({model: retry.model, provider: retry.provider, status: 'pending', done: false});
  feed.current = traceFrame(3, [retry]);
  await expect(page.locator('.route-lane')).toContainText('等待生成');
  await expect(page.locator('.live-halo.pulse')).toHaveCount(1);
  await expect(page.locator('#route-diagram .route-path.attempt')).toHaveCount(2);
  const completed = structuredClone(retry);
  completed.done = true; completed.status = 'success'; completed.attempts[1].done = true; completed.attempts[1].status = 'success';
  feed.current = traceFrame(4, [completed]);
  await expect(page.locator('#route-active')).toContainText('0 活跃');
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await expect(page.locator('#request-detail')).toContainText('claude-sonnet-4-6');
  expect(issues).toEqual([]);
});

test('terminal requests release a held packet even when the attempt has no terminal frame', async ({page}) => {
  const first = traceRoute();
  const feed = {current: traceFrame(1, [first])};
  await liveFixture(page, feed);
  await page.goto('/');
  await expect(page.locator('.live-halo.pulse')).toHaveCount(1);
  feed.current = traceFrame(2, [{...first, done: true, status: 'success'}]);
  await expect(page.locator('#route-active')).toContainText('0 活跃');
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);

  const second = traceRoute('terminal-error');
  feed.current = traceFrame(3, [second]);
  await expect(page.locator('.live-halo.pulse')).toHaveCount(1);
  feed.current = traceFrame(4, [{...second, done: true, status: 'error'}]);
  await expect(page.locator('#route-active')).toContainText('0 活跃');
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
});

test('new nodes and selection preserve in-flight paths while unselected failures leave traces', async ({page}) => {
  const first = traceRoute();
  const second = {...traceRoute('secondary'), group: 'reasoning', model: 'second-model', provider: 'anthropic',
    attempts: [{model: 'second-model', provider: 'anthropic', status: 'pending', done: false}]};
  const feed = {current: traceFrame(1, [first, second])};
  await liveFixture(page, feed);
  await page.goto('/');
  await expect(page.locator('.live-halo.pulse')).toHaveCount(2);
  const firstLeg = page.locator('[data-flow-index="0"] [data-leg="model"]');
  const secondLeg = page.locator('[data-flow-index="1"] [data-leg="model"]');
  const paths = [await firstLeg.getAttribute('d'), await secondLeg.getAttribute('d')];
  const endpoints = await page.locator('.live-packet-shell').evaluateAll(nodes => nodes.map(node => node.getAttribute('cy')));
  const third = {...traceRoute('burst'), group: 'burst', model: 'burst-model', provider: 'burst-provider',
    attempts: [{model: 'burst-model', provider: 'burst-provider', status: 'pending', done: false}]};
  feed.current = traceFrame(2, [first, second, third]);
  await expect(page.locator('#route-active')).toContainText('3 活跃');
  await expect(firstLeg).toHaveAttribute('d', paths[0]);
  await expect(secondLeg).toHaveAttribute('d', paths[1]);
  await expect(page.locator('.live-packet-shell').first()).toHaveAttribute('cy', endpoints[0]);
  await expect(page.locator('.live-packet-shell').nth(1)).toHaveAttribute('cy', endpoints[1]);
  await page.locator('.route-lane').nth(1).click();
  await expect(page.locator('#route-caption')).toContainText('secondary');
  await expect(firstLeg).toHaveAttribute('d', paths[0]);
  await expect(secondLeg).toHaveAttribute('d', paths[1]);
  await expect(page.locator('.live-packet-shell').first()).toHaveAttribute('cy', endpoints[0]);
  await expect(page.locator('.live-packet-shell').nth(1)).toHaveAttribute('cy', endpoints[1]);
  const failed = structuredClone(first);
  failed.attempts[0].status = 'error'; failed.attempts[0].done = true;
  feed.current = traceFrame(3, [failed, second, third]);
  await expect(page.locator('.route-lane').first()).toContainText('等待重选');
  await expect(page.locator('#route-diagram .route-path.attempt')).toHaveCount(2);
  await expect(page.locator('#graph-note')).toContainText('活跃车道含回退尝试');
});

test('four simultaneous retries retain every failed branch without overlapping model or provider nodes', async ({page}) => {
  const routes = Array.from({length: 4}, (_, index) => ({...traceRoute(index ? `parallel-${index}` : 'live-1'),
    group: `group-${index}`, model: `current-${index}`, provider: `current-provider-${index}`,
    attempts: [
      {model: `failed-${index}`, provider: `failed-provider-${index}`, status: 'error', done: true},
      {model: `current-${index}`, provider: `current-provider-${index}`, status: 'pending', done: false}
    ]}));
  const feed = {current: traceFrame(1, routes)};
  await liveFixture(page, feed);
  await page.goto('/');
  await expect(page.locator('.live-halo.pulse')).toHaveCount(4);
  await expect(page.locator('#route-diagram .route-path.attempt')).toHaveCount(8);
  await expect(page.locator('#route-diagram .route-fallback-archive')).toHaveCount(0);
  const columns = await page.locator('#route-diagram .graph-node rect').evaluateAll(rects => {
    const byColumn = {};
    for (const rect of rects) {
      const x = rect.getAttribute('x');
      (byColumn[x] ||= []).push({y: Number(rect.getAttribute('y')), h: Number(rect.getAttribute('height'))});
    }
    return byColumn;
  });
  for (const column of Object.values(columns)) {
    column.sort((a, b) => a.y - b.y);
    for (let index = 1; index < column.length; index++) expect(column[index].y - column[index - 1].y - column[index - 1].h).toBeGreaterThanOrEqual(3);
  }
  expect(columns['326']).toHaveLength(8);
  expect(columns['630']).toHaveLength(8);
  await page.screenshot({path: '.impeccable/review/desktop-four-retries.png', fullPage: true});

  const extra = structuredClone(routes);
  extra[0].attempts[1].status = 'error'; extra[0].attempts[1].done = true;
  extra[0].attempts.push({model: 'last-model', provider: 'last-provider', status: 'pending', done: false});
  extra[0].model = 'last-model'; extra[0].provider = 'last-provider';
  feed.current = traceFrame(2, extra);
  await expect(page.locator('#route-diagram .route-fallback-archive')).toHaveCount(1);
  await expect(page.locator('#route-diagram .route-fallback-archive')).toContainText('其余回退轨迹');
  await expect(page.locator('#route-diagram .route-fallback-archive [role=listitem]')).toHaveCount(1);
});

test('four live lanes keep their destinations while new traffic queues and resume after navigation', async ({page}) => {
  const routes = Array.from({length: 5}, (_, index) => ({...traceRoute(`traffic-${index}`),
    group: `group-${index}`, model: `model-${index}`, provider: `provider-${index}`,
    timestamp: new Date(Date.now() - index * 1000).toISOString(),
    attempts: [{model: `model-${index}`, provider: `provider-${index}`, status: 'pending', done: false}]}));
  const feed = {current: traceFrame(1, routes)};
  await liveFixture(page, feed);
  await page.goto('/');
  await expect(page.locator('#route-active')).toContainText('5 活跃');
  await expect(page.locator('#route-queued')).toHaveText('+1 排队');
  await expect(page.locator('.live-packet-shell')).toHaveCount(4);
  await expect(page.locator('.live-halo.pulse')).toHaveCount(4);
  const firstLanes = ['group-0 → model-0', 'group-1 → model-1', 'group-2 → model-2', 'group-3 → model-3'];
  await expect(page.locator('.route-lane .lane-name')).toHaveText(firstLanes);
  const next = {...traceRoute('traffic-5'), group: 'group-5', model: 'model-5', provider: 'provider-5',
    timestamp: new Date(Date.now() + 1000).toISOString(),
    attempts: [{model: 'model-5', provider: 'provider-5', status: 'pending', done: false}]};
  feed.current = traceFrame(2, [...routes, next]);
  await expect(page.locator('#route-queued')).toHaveText('+2 排队');
  await expect(page.locator('.route-lane .lane-name')).toHaveText(firstLanes);
  await page.locator('[data-view=groups]').click();
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await page.locator('[data-view=overview]').click();
  await expect(page.locator('.live-packet-shell')).toHaveCount(4);
  await expect(page.locator('#route-queued')).toHaveText('+2 排队');
});

test('motion control, reset, reduced motion and compact selection keep an honest static state', async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  const feed = {current: traceFrame(8, [traceRoute()])};
  await liveFixture(page, feed);
  await page.goto('/?embed=1');
  await expect(page.locator('.compact-route')).toBeVisible();
  await expect(page.locator('.compact-stage')).toContainText('等待生成');
  await expect(page.locator('.live-packet-shell')).toHaveCount(1);
  await page.screenshot({path: '.impeccable/review/mobile-live.png', fullPage: true});
  await page.locator('#motion-toggle').click();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await expect(page.locator('.compact-stage')).toContainText('等待生成');
  await page.reload();
  await expect(page.locator('#motion-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await page.locator('#motion-toggle').click();
  await expect(page.locator('.live-packet-shell')).toHaveCount(1);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await expect(page.locator('.compact-step.current')).toHaveCount(1);
  await expect(page.locator('#motion-toggle')).toContainText('遵循系统减弱动态');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  feed.current = traceFrame(1, [traceRoute('live-2')], {epoch: 'new-owner', reset: true});
  await expect(page.locator('.live-packet-shell')).toHaveCount(1);
  await expect(page.locator('.route-lane')).toContainText('coding');
  await expect(page.locator('#route-active')).toContainText('1 活跃');
  feed.current = traceFrame(2, [], {epoch: 'new-owner', mine: false});
  await expect(page.locator('.live-packet-shell')).toHaveCount(0);
  await expect(page.locator('.compact-route')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
