// The site in WebKit at iPhone and iPad sizes: nothing sideways, no console errors, the right install steps,
// nothing under the notch or home bar. Safe areas are emulated through the --safe-* tokens in global.css.
import { test, expect } from '@playwright/test';

const INSETS = { top: 47, bottom: 34 };

// The site's CSP says upgrade-insecure-requests, which makes WebKit ask for https on localhost. Live is on https and is not
// affected. Only the page and the service worker file are rewritten: API calls stay untouched, so cookies behave as in a real browser.
async function allowLocalhost(context) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const rewrite = req.resourceType() === 'document' || req.url().endsWith('/sw.js');
    if (!rewrite || !req.url().startsWith('http://localhost')) return route.continue();
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers['content-security-policy'];
    delete headers['strict-transport-security'];
    return route.fulfill({ response: res, headers });
  });
}

const watch = (page) => {
  const errors = [];
  page.on('console', (m) => {
    // Said by Playwright itself, because the config blocks service workers
    if (['error', 'warning'].includes(m.type()) && !m.text().includes('blocked by Playwright')) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
};

async function open(page, path) {
  await page.goto(path, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
}

const noSideways = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

/** The notch and home bar, as an iPhone reports them. */
const emulateInsets = (page) => page.addStyleTag({ content: `:root { --safe-top: ${INSETS.top}px !important; --safe-bottom: ${INSETS.bottom}px !important; }` });

/** Everyone who can be clear of the notch and home bar is: returns anything that sits in those strips. */
async function hiddenByInsets(page, selectors) {
  return page.evaluate(({ list, ins }) => {
    const out = [];
    for (const sel of list) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
        if (r.top < ins.top && r.bottom > 0) out.push(`${sel} top ${Math.round(r.top)}`);
        if (r.bottom > window.innerHeight - ins.bottom && r.top < window.innerHeight) out.push(`${sel} bottom ${Math.round(window.innerHeight - r.bottom)}`);
      }
    }
    return out;
  }, { list: selectors, ins: INSETS });
}

async function signIn(context, baseURL, login) {
  const { issueCaptchaToken } = await import('../server/src/services/captcha.service.js');
  const res = await context.request.post(`${baseURL}/api/auth/login`, { data: { ...login, captchaToken: issueCaptchaToken() } });
  expect(res.status(), `sign in as ${login.identifier}`).toBe(200);
}

const USERS = {
  admin: { tenantCode: 'demo-college', role: 'admin', identifier: 'ADM001', password: 'Admin@123', home: '/admin/dashboard' },
  employee: { tenantCode: 'demo-college', role: 'employee', identifier: 'EMP001', password: 'Employee@123', home: '/employee/dashboard' },
  student: { tenantCode: 'demo-college', role: 'student', identifier: 'STU2026001', password: 'Student@123', home: '/student/dashboard' },
  parent: { tenantCode: 'demo-college', role: 'parent', identifier: 'PAR001', password: 'Parent@123', home: '/parent/home' },
  super_admin: { role: 'super_admin', identifier: 'SA001', password: 'SuperAdmin@123', home: '/super-admin/dashboard' },
};

test.beforeEach(async ({ context }) => { await allowLocalhost(context); });

test('landing page: nothing sideways, no console errors, clear of the home bar', async ({ page }) => {
  const errors = watch(page);
  await open(page, '/');
  await noSideways(page);
  await emulateInsets(page);
  expect(await hiddenByInsets(page, ['.lp-bubble', '.lp-sticky a', '.lp-sticky button'])).toEqual([]);
  const nav = await page.locator('.lp-nav').evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
  expect(nav).toBeGreaterThanOrEqual(INSETS.top);
  expect(errors).toEqual([]);
});

test('sign-in page: the install sheet shows the real steps, without covering the form', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, '/login');
  await noSideways(page);
  await emulateInsets(page);
  // The form scrolls, so it only has to be able to rise clear of the home bar
  expect(await hiddenByInsets(page, ['.getapp-banner .btn'])).toEqual([]);
  expect(await page.locator('.login__panel').evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThanOrEqual(INSETS.bottom);

  // In the page flow, above the form: nothing lies over the first field
  const covered = await page.evaluate(() => {
    const field = document.querySelector('.login__card input');
    const r = field.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !(field === top || field.contains(top) || field.closest('.input-wrap')?.contains(top));
  });
  expect(covered).toBe(false);

  const device = info.project.name === 'iPad' ? 'iPad' : 'iPhone';
  await page.getByRole('button', { name: `Install on ${device}` }).first().click();
  const sheet = page.getByRole('dialog', { name: `Install on ${device}` });
  await expect(sheet).toContainText('Share');
  await expect(sheet).toContainText('Add to Home Screen');
  await expect(sheet.locator('svg').first()).toBeVisible();
  expect(/chrome/i.test(await sheet.innerText())).toBe(false);
  expect(/chrome/i.test(await page.locator('body').innerText())).toBe(false);
  await noSideways(page);
  expect(errors).toEqual([]);
});

test('sign-in page: closing the banner holds after a reload', async ({ page }) => {
  await open(page, '/login');
  await page.locator('.getapp-banner').getByRole('button', { name: 'Close' }).click();
  await open(page, '/login');
  await expect(page.locator('.getapp-banner')).toHaveCount(0);
  await expect(page.locator('.getapp')).toBeVisible();
});

test('install page: this device first with its steps open, and no other browser named', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, '/install');
  await noSideways(page);
  await expect(page.locator('.install-card')).toHaveCount(3);
  const first = page.locator('.install-card').first();
  await expect(first).toHaveAttribute('id', 'iphone');
  await expect(first).toHaveClass(/is-here/);
  await expect(first).toContainText('This device');
  await expect(first).toContainText('Add to Home Screen');
  await expect(first.locator('.install-sheet__icon svg').first()).toBeVisible();
  await expect(page.locator('.install-qr')).toHaveCount(0);
  expect(/chrome/i.test(await page.locator('body').innerText())).toBe(false);
  // The other two can still be opened
  await page.locator('#computer summary').click();
  await expect(page.locator('#computer')).toContainText('Install');
  await noSideways(page);
  const small = await page.evaluate(() => [...document.querySelectorAll('.install-page a, .install-page button, .install-page summary')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height < 44; }).map((el) => el.innerText.trim()));
  expect(small, info.title).toEqual([]);
  expect(errors).toEqual([]);
});

test('landing page: Get the app shows three cards, marks this device, and leads to the install page', async ({ page }) => {
  await open(page, '/');
  const cards = page.locator('.lp-grid--getapp .lp-card');
  await expect(cards).toHaveCount(3);
  await expect(page.locator('.lp-grid--getapp .is-here')).toContainText('iPhone and iPad');
  expect(/chrome/i.test(await page.locator('#get-app').locator('..').innerText())).toBe(false);
  await page.locator('.lp-grid--getapp .is-here').click();
  await expect(page).toHaveURL(/\/install#iphone$/);
  await expect(page.locator('#iphone')).toContainText('Add to Home Screen');
});

test('sign-in page: a link can name the institute, and a plain visit starts with no code', async ({ page }) => {
  await open(page, '/login?institute=Demo-College');
  await expect(page.locator('.login__card input').first()).toHaveValue('demo-college');
  await page.evaluate(() => localStorage.clear());
  await open(page, '/login');
  await expect(page.locator('.login__card input').first()).toHaveValue('');
});

test('fields are at least 16 px, so iOS does not zoom on focus', async ({ page }) => {
  await open(page, '/login');
  const small = await page.evaluate(() => [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]), select, textarea')]
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.name || el.id || el.type));
  expect(small).toEqual([]);
});

test.describe('service worker', () => {
  test.use({ serviceWorkers: 'allow' });
  test('it registers and the app opens', async ({ page }) => {
    await open(page, '/login');
    const state = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((reg) => (reg.active ? 'active' : 'not active')),
      new Promise((r) => { setTimeout(() => r('timed out'), 20000); }),
    ]));
    expect(state).toBe('active');
    await expect(page.locator('.login__card')).toBeVisible();
  });
});

test('the page says it can be installed on iOS', async ({ page, request }) => {
  await open(page, '/login');
  const meta = (name) => page.locator(`meta[name="${name}"]`).getAttribute('content');
  expect(await meta('apple-mobile-web-app-capable')).toBe('yes');
  expect(await meta('apple-mobile-web-app-title')).toBeTruthy();
  expect(await meta('apple-mobile-web-app-status-bar-style')).toBeTruthy();
  expect(await meta('theme-color')).toBeTruthy();
  expect(await meta('viewport')).toContain('viewport-fit=cover');
  const icon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(icon)).status()).toBe(200);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  for (const k of ['name', 'short_name', 'start_url', 'scope']) expect(manifest[k], k).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
});

for (const [role, user] of Object.entries(USERS)) {
  test(`${role} dashboard: nothing sideways, no console errors, 44 px targets, clear of the notch`, async ({ page, context, baseURL }) => {
    const errors = watch(page);
    const { home, ...login } = user;
    await signIn(context, baseURL, login);
    // A parent answers the consent screen first
    if (role === 'parent') expect((await context.request.post(`${baseURL}/api/me/consent`, { data: { answers: { records: true } } })).status()).toBeLessThan(300);
    await open(page, home);
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    await page.waitForSelector('.topbar');
    await noSideways(page);
    await emulateInsets(page);
    expect(await hiddenByInsets(page, ['.topbar button', '.bottomnav__item'])).toEqual([]);
    const small = await page.evaluate(() => [...document.querySelectorAll('.topbar button, .bottomnav__item')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width && (r.height < 44 || r.width < 44); })
      .map((el) => `${el.getAttribute('aria-label') || el.innerText.trim()} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`));
    expect(small).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test.describe('installed on the home screen', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { value: true }));
  });

  test('the front address goes to sign in, and no install offer shows', async ({ page }) => {
    await open(page, '/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('.getapp-banner')).toHaveCount(0);
    await expect(page.locator('.getapp')).toHaveCount(0);
    await open(page, '/install');
    await expect(page.locator('.install-page__main')).toContainText('already using the PlanetU app');
    await expect(page.locator('.install-card')).toHaveCount(0);
  });

  test('signing in stays signed in after closing the app, and signing out works', async ({ page, context, baseURL }) => {
    const { home, ...login } = USERS.student;
    await signIn(context, baseURL, login);
    await open(page, '/');
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    // Closing and reopening: the cookie carries a lifetime, so it outlives the app's window
    const cookie = (await context.cookies()).find((c) => c.httpOnly && c.sameSite === 'Lax' && c.expires > Date.now() / 1000 + 3600);
    expect(cookie, 'a lasting first-party session cookie').toBeTruthy();
    await page.close();
    const again = await context.newPage();
    await open(again, '/');
    await expect(again).toHaveURL(new RegExp(`${home}$`));
    await again.locator('.usermenu, .topbar__right button').last().click();
    await again.getByRole('button', { name: 'Sign out' }).click();
    await expect(again).toHaveURL(/\/login$/);
    await expect.poll(async () => (await context.cookies()).filter((c) => c.name === 'erp_session').length).toBe(0);
    const after = await context.newPage();
    await open(after, '/');
    await expect(after).toHaveURL(/\/login$/);
  });

  test('inner pages have a back button, and documents open inside the app', async ({ page, context, baseURL }) => {
    const errors = watch(page);
    const { home, ...login } = USERS.student;
    await signIn(context, baseURL, login);
    await open(page, home);
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toHaveCount(0);
    await open(page, '/student/profile');
    const back = page.getByRole('button', { name: 'Back', exact: true });
    await expect(back).toBeVisible();

    const link = page.locator('a[href="/api/student/id-card.pdf"]');
    if (await link.count()) {
      const pages = context.pages().length;
      await link.first().click();
      await expect(page.locator('.docview')).toBeVisible();
      await expect(page.locator('.docview iframe')).toHaveAttribute('src', '/api/student/id-card.pdf');
      expect(context.pages().length).toBe(pages);
      await page.getByRole('button', { name: 'Close' }).click();
      await expect(page.locator('.docview')).toHaveCount(0);
    }

    await back.click();
    await expect(page).toHaveURL(new RegExp(`${home}$`));
    expect(errors).toEqual([]);
  });
});
