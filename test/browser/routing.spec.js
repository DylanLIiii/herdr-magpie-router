import { test, expect } from '@playwright/test';

test('demo supports route inspection, filtering, navigation, export and pause', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?mode=demo');
  await expect(page.locator('#metric-requests')).toHaveText('64');
  await expect(page.locator('#source-badge')).toHaveText('演示数据');
  await expect(page.locator('#route-diagram svg')).toBeVisible();
  await page.locator('#status-filter').selectOption('fallback');
  await expect(page.locator('#request-count')).toHaveText('5 条');
  await page.locator('.request-select').first().click();
  await expect(page.locator('#request-detail')).toBeVisible();
  await expect(page.locator('#request-detail')).toContainText('429');
  await expect(page.locator('#route-diagram .attempt')).toHaveCount(2);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export').click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/magpie-requests-demo/);
  await page.locator('#search').fill('no-such-model');
  await expect(page.locator('#requests-empty')).toContainText('没有匹配的请求');
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('#clear-filters').click();
  await expect(page.locator('#request-count')).toHaveText('64 条');
  await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveAttribute('aria-pressed', 'true');
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
    await page.goto(`/?mode=demo${query}`);
    await expect(page.locator('#metric-requests')).toHaveText('64');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow).toBe(false);
    await page.locator('#refresh').focus();
    await expect(page.locator('#refresh')).toBeFocused();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
  });
}
