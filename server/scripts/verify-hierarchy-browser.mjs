import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath)
  throw new Error('Set PLAYWRIGHT_MODULE to an already installed playwright/index.mjs');
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5180/org-hierarchy', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.locator('#email').fill('admin@hierarchy.test');
  await page.locator('#password').fill('HierarchyTest-only-2026!');
  await page.locator('button[type=submit]').click();
  await page.waitForURL((url) => !url.pathname.includes('login'));
  await page.goto('http://127.0.0.1:5180/org-hierarchy', { waitUntil: 'domcontentloaded' });
  await page.getByText('Organization hierarchy', { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.body.innerText.includes('Hierarchy browser rehearsal'),
    undefined,
    { timeout: 60000 },
  );

  assert.match(await page.locator('body').innerText(), /Hierarchy browser rehearsal/);
  const api = async (method, url, data) =>
    page.evaluate(
      async ({ method, url, data }) => {
        const { apiClient } = await import('/src/shared/api/client.ts');
        const res = await apiClient.request({ method, url, data });
        return res.data?.data;
      },
      { method, url, data },
    );
  const read = () => api('get', '/admin/org/hierarchy');
  // Only fixture-generated data is in scope; allow repeatable reruns after a failed assertion.
  let graph = await read();
  while (graph.nodes.length) {
    const leaf = graph.nodes.find(
      (n) => !graph.reportingLines.some((e) => e.managerNodeId === n.id),
    );
    assert.ok(leaf, 'Fixture contains cycle');
    await api('delete', '/admin/org/hierarchy/nodes/' + leaf.id);
    graph = await read();
  }
  await page.evaluate(async () => {
    const { queryClient } = await import('/src/app/query/queryClient.ts');
    await queryClient.invalidateQueries({ queryKey: ['org-hierarchy'] });
  });
  await page.getByRole('button', { name: 'Create position', exact: true }).waitFor();
  const chart = page.getByRole('region', { name: /^Organization chart/ });
  const card = (title) => chart.getByRole('article', { name: title, exact: true });
  async function create(title, managers = [], quantity = 1) {
    await page.getByRole('button', { name: 'Create position', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Position title', { exact: true }).fill(title);
    assert.equal(await dialog.getByLabel('Department', { exact: true }).count(), 0);
    assert.equal(await dialog.getByLabel('Display order', { exact: true }).count(), 0);
    if (quantity > 1)
      await dialog.getByLabel('Number of positions', { exact: true }).fill(String(quantity));
    for (const manager of managers)
      await dialog.getByRole('checkbox', { name: new RegExp(manager) }).check();
    await dialog
      .getByRole('button', {
        name: quantity === 1 ? 'Create position' : `Create ${quantity} positions`,
        exact: true,
      })
      .click();
    await dialog.waitFor({ state: 'hidden' });
    await card(title).first().waitFor();
  }
  await create('Chairman');
  await create('CEO', ['Chairman']);
  await create('CTO', ['Chairman']);
  await create('Manager 1', ['CEO', 'CTO']);
  await create('Manager 2', ['CEO', 'CTO']);
  await page.getByRole('button', { name: 'Create position', exact: true }).click();
  const searchableDialog = page.getByRole('dialog');
  await searchableDialog
    .getByLabel('Search reporting positions', { exact: true })
    .fill('Manager 1');
  assert.equal(await searchableDialog.getByRole('checkbox').count(), 1);
  await searchableDialog.getByRole('button', { name: 'Close', exact: true }).click();
  await create('Staff', ['Manager 1'], 5);
  for (const [title, manager] of [
    ['E1', 'Manager 1'],
    ['E2', 'Manager 1'],
    ['E3', 'Manager 2'],
    ['E4', 'Manager 2'],
  ])
    await create(title, [manager]);
  graph = await read();
  assert.equal(graph.nodes.length, 14);
  assert.equal(graph.nodes.filter((n) => n.title === 'Staff').length, 5);
  assert.equal(graph.reportingLines.length, 15);
  assert.ok(graph.nodes.every((n) => n.user === null));
  assert.equal(await chart.getByRole('article').count(), 14);
  assert.equal(await chart.locator('svg > path').count(), 4);
  assert.equal(await chart.locator('svg > circle').count(), 13);
  assert.ok(
    await chart.locator('svg > path').evaluateAll((paths) =>
      paths.every((path) => path.getAttribute('d')?.includes(' V')),
    ),
    'Shared reporting relationships must use clean grouped connector trunks',
  );
  assert.ok(
    await chart.getByRole('article').evaluateAll((cards) => {
      const boxes = cards.map((card) => card.getBoundingClientRect());
      return boxes.every((a, i) =>
        boxes.slice(i + 1).every(
          (b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        ),
      );
    }),
    'Created position cards must not overlap',
  );
  assert.ok(
    await chart.getByRole('article').evaluateAll((cards) =>
      cards.every(
        (card) => card.scrollHeight <= card.clientHeight + 1 && card.scrollWidth <= card.clientWidth + 1,
      ),
    ),
    'Desktop cards must not have nested scrollbars',
  );
  assert.ok(
    await chart.evaluate(
      (element) =>
        element.scrollHeight > element.clientHeight && element.scrollWidth > element.clientWidth,
    ),
    'Large charts must be pannable in both directions',
  );
  const baseCardWidth = (await card('Chairman').boundingBox()).width;
  await chart.scrollIntoViewIfNeeded();
  await chart.hover({ position: { x: 120, y: 80 } });
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(200);
  assert.equal(
    await page.getByRole('button', { name: 'Reset zoom to 100%', exact: true }).innerText(),
    '90%',
    'Mouse wheel must change chart zoom',
  );
  await page.getByRole('button', { name: 'Reset zoom to 100%', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Reset zoom to 100%', exact: true }).filter({ hasText: '125%' }).waitFor();
  assert.ok((await card('Chairman').boundingBox()).width > baseCardWidth);
  await chart.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  await chart.scrollIntoViewIfNeeded();
  const chartBox = await chart.boundingBox();
  await page.mouse.move(chartBox.x + 120, chartBox.y + 80);
  await page.mouse.down();
  await page.mouse.move(chartBox.x + 50, chartBox.y + 20, { steps: 4 });
  await page.mouse.up();
  assert.ok(
    await chart.evaluate((element) => element.scrollLeft > 0 || element.scrollTop > 0),
    'Mouse drag must pan the chart',
  );
  await page.getByRole('button', { name: 'Reset zoom to 100%', exact: true }).click();
  await page.getByRole('button', { name: 'Reset zoom to 100%', exact: true }).filter({ hasText: '100%' }).waitFor();
  await card('Manager 1').getByRole('button', { name: 'Collapse', exact: true }).click();
  await create('Expansion check', ['Manager 1']);
  const expansionNode = (await read()).nodes.find((node) => node.title === 'Expansion check');
  assert.ok(expansionNode, 'Expansion check position must be created');
  await api('delete', '/admin/org/hierarchy/nodes/' + expansionNode.id);
  await page.evaluate(async () => {
    const { queryClient } = await import('/src/app/query/queryClient.ts');
    await queryClient.invalidateQueries({ queryKey: ['org-hierarchy'] });
  });
  await card('Expansion check').waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 537, height: 632 });
  await page
    .locator('article:visible[aria-label="Manager 1"]')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const editor = page.getByRole('dialog');
  const modalLayout = await editor.evaluate((dialog) => {
    const panel = dialog.firstElementChild;
    const body = panel?.children[1];
    const footer = panel?.lastElementChild;
    if (!(panel instanceof HTMLElement) || !(body instanceof HTMLElement) || !(footer instanceof HTMLElement))
      return null;
    const dialogRect = dialog.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      fitsViewport: dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight,
      bodyScrolls: body.scrollHeight > body.clientHeight,
      footerSeparated: bodyRect.bottom <= footerRect.top + 1,
      childrenDoNotShrink: [...body.children].every(
        (child) => getComputedStyle(child).flexShrink === '0',
      ),
    };
  });
  assert.deepEqual(modalLayout, {
    fitsViewport: true,
    bodyScrolls: true,
    footerSeparated: true,
    childrenDoNotShrink: true,
  });
  await page.screenshot({ path: '../.tmp-hierarchy-pg/modal-overflow-fixed.png' });
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  process.stdout.write('PASS: bulk create, auto-expand, no overlap, zoom buttons and mouse pan\n');
  async function assign(title, search) {
    await card(title).getByRole('button', { name: 'Assign user', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Select user or mailbox…' }).click();
    await page.getByPlaceholder('Search…', { exact: true }).fill(search);
    await dialog
      .getByRole('listbox', { name: 'Available options' })
      .getByRole('option')
      .first()
      .waitFor();
    await page.getByPlaceholder('Search…', { exact: true }).press('ArrowDown');
    await page.keyboard.press('Enter');
    await dialog.getByRole('checkbox', { name: 'Confirm this change to reporting access' }).check();
    await dialog.getByRole('button', { name: 'Assign selected user' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  await assign('CEO', 'ceo@hierarchy.test');
  await assign('CTO', 'cto@hierarchy.test');
  await assign('E1', 'employee@hierarchy.test');
  await assign('E4', 'mailbox-204@hierarchy.test');
  graph = await read();
  const ceo = graph.nodes.find((n) => n.title === 'CEO'),
    cto = graph.nodes.find((n) => n.title === 'CTO');
  const ceoScope = await api('get', '/admin/org/hierarchy/scope/' + ceo.userId);
  const ctoScope = await api('get', '/admin/org/hierarchy/scope/' + cto.userId);
  assert.equal(ceoScope.mailboxIds.length, 3);
  assert.equal(ctoScope.mailboxIds.length, 3);
  assert.equal(graph.reportingLines.length, 15);
  await card('CEO').getByRole('button', { name: 'Access preview' }).click();
  await page
    .getByRole('dialog')
    .getByText(/3 distinct mailbox/)
    .waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /3 distinct mailbox/);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  process.stdout.write('PASS: assignments, final mailbox beyond 200, both executive scopes\n');
  await card('CEO').getByRole('button', { name: 'Collapse', exact: true }).click();
  assert.equal(await card('Manager 1').count(), 1);
  await card('CTO').getByRole('button', { name: 'Collapse', exact: true }).click();
  assert.equal(await card('Manager 1').count(), 0);
  await page.getByRole('button', { name: 'Expand all', exact: true }).click();
  await card('E1').getByRole('button', { name: 'Assignment', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('checkbox', { name: 'Confirm this change to reporting access' })
    .check();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Unassign user; keep position' })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  graph = await read();
  assert.equal(graph.nodes.find((n) => n.title === 'E1').userId, null);
  assert.equal(graph.reportingLines.length, 15);
  await page.screenshot({ path: '../.tmp-hierarchy-pg/hierarchy-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 1024, height: 768 });
  assert.equal(await chart.isVisible(), false);
  assert.equal(await page.locator('article:visible').count(), 14);
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Tablet page must not overflow horizontally',
  );
  await page.setViewportSize({ width: 375, height: 844 });
  assert.equal(await chart.isVisible(), false);
  assert.equal(await page.locator('article:visible').count(), 14);
  assert.equal(
    await page.locator('article:visible').first().getAttribute('aria-label'),
    'Chairman',
  );
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    'Mobile page must not overflow horizontally',
  );
  await page.locator('article:visible').first().getByRole('button').first().focus();
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.activeElement !== document.body));
  await page.waitForFunction(() =>
    [...document.querySelectorAll('aside')].every((el) => el.getBoundingClientRect().right <= 0),
  );
  await page.getByRole('button', { name: 'Create position', exact: true }).click();
  const mobileCreate = page.getByRole('dialog');
  assert.equal(await mobileCreate.getByLabel('Number of positions', { exact: true }).count(), 1);
  await mobileCreate.getByLabel('Search reporting positions', { exact: true }).fill('CEO');
  assert.equal(
    await mobileCreate.getByRole('checkbox', { name: /CEO.*CEO.*No department/ }).count(),
    1,
  );
  assert.ok(
    await mobileCreate.evaluate(
      (dialog) => dialog.getBoundingClientRect().width <= window.innerWidth && dialog.scrollWidth <= dialog.clientWidth,
    ),
    'Mobile create dialog must fit without horizontal overflow',
  );
  await mobileCreate.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: '../.tmp-hierarchy-pg/hierarchy-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 667, height: 375 });
  await page.getByRole('button', { name: 'Create position', exact: true }).click();
  const landscapeCreate = page.getByRole('dialog');
  assert.ok(
    await landscapeCreate.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= window.innerHeight && dialog.scrollWidth <= dialog.clientWidth;
    }),
    'Landscape create dialog must fit the viewport',
  );
  await landscapeCreate.getByRole('button', { name: 'Close', exact: true }).click();
  process.stdout.write(
    'PASS: alternate collapse paths, unassignment, 375px and landscape modal layout\n',
  );

  await page.route('**/api/v1/admin/org/hierarchy', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'test_failure', message: 'Simulated read failure' } }),
    }),
  );
  await page.evaluate(async () => {
    const { queryClient } = await import('/src/app/query/queryClient.ts');
    await queryClient.invalidateQueries({ queryKey: ['org-hierarchy'] });
  });
  await page.getByText(/Could not load hierarchy/).waitFor();
  await page.unroute('**/api/v1/admin/org/hierarchy');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText(/Could not load hierarchy/).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('article:visible').count(), 14);
  process.stdout.write('PASS: hierarchy read-error display and recovery\n');

  assert.equal(errors.length, 0, errors.join('\n'));
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  await page
    ?.screenshot({ path: '../.tmp-hierarchy-pg/hierarchy-failure.png', fullPage: true })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
