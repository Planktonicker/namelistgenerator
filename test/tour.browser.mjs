/* The walk-through both pages show the first time somebody opens them.
 * Neither page is handed to somebody who asked for it, so each introduces
 * itself once — and then never again unless it is asked back. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));
copyFileSync(join(repo, 'dist/namelist.html'), join(demo, 'namelist.html'));
copyFileSync(join(repo, 'sample/data.js'), join(demo, 'data.js'));
// a second copy, to prove the "already seen" mark is scoped to the folder
const other = join(demo, 'Another year');
mkdirSync(other);
copyFileSync(join(repo, 'dist/namelist.html'), join(other, 'namelist.html'));
copyFileSync(join(repo, 'sample/data.js'), join(other, 'data.js'));

const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
// one context throughout: localStorage has to persist for "seen" to mean anything
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
const errors = [];
ctx.on('page', (pg) => pg.on('pageerror', (e) => errors.push(String(e))));

// ---------------- the teacher page ----------------
let page = await ctx.newPage();
await page.goto('file://' + demo + '/namelist.html?tour=on');
await page.waitForTimeout(400);

check('it introduces itself the first time the page is opened',
  await page.locator('.tour-bubble').isVisible());
check('starting at step one of six',
  (await page.locator('.tour-count').innerText()) === '1 of 6',
  await page.locator('.tour-count').innerText());
check('the first step says the page changes nothing',
  (await page.locator('.tour-body').innerText()).toLowerCase().includes('read-only'));
check('and Back is not offered on it', await page.locator('.tour-back').isDisabled());

await page.click('.tour-next');
await page.waitForTimeout(300);
check('the next step points at the name box',
  await page.locator('.tour-ring').isVisible() &&
  (await page.locator('#tourTitle').innerText()).includes('name'),
  await page.locator('#tourTitle').innerText());
const ring = await page.locator('.tour-ring').boundingBox();
const box = await page.locator('#teacherSearch').boundingBox();
check('and the highlight sits over it, not somewhere else',
  Math.abs(ring.x - box.x) < 12 && Math.abs(ring.y - box.y) < 12,
  'ring ' + Math.round(ring.x) + ',' + Math.round(ring.y) +
  ' vs field ' + Math.round(box.x) + ',' + Math.round(box.y));

await page.keyboard.press('ArrowLeft');
await page.waitForTimeout(250);
check('arrow keys walk back and forward',
  (await page.locator('.tour-count').innerText()) === '1 of 6',
  await page.locator('.tour-count').innerText());

for (let i = 0; i < 5; i++) { await page.click('.tour-next'); await page.waitForTimeout(200); }
check('the last step offers Done rather than Next',
  (await page.locator('.tour-next').innerText()) === 'Done');
await page.click('.tour-next');
await page.waitForTimeout(250);
check('Done closes it', !(await page.locator('.tour-bubble').isVisible()));

await page.reload();
await page.waitForTimeout(400);
check('it does not come back on the next open',
  !(await page.locator('.tour-bubble').isVisible()));
await page.click('#tourBtn');
await page.waitForTimeout(250);
check('but "Show me around" brings it back',
  await page.locator('.tour-bubble').isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
check('and Escape closes it', !(await page.locator('.tour-bubble').isVisible()));

// a second copy of the app, in its own folder, is a different situation
const second = await ctx.newPage();
await second.goto('file://' + other + '/namelist.html?tour=on');
await second.waitForTimeout(400);
check('a copy in another folder introduces itself to whoever opens that one',
  await second.locator('.tour-bubble').isVisible());
await second.close();
await page.close();

// ---------------- the admin page ----------------
page = await ctx.newPage();
await page.goto('file://' + demo + '/admin.html?tour=on');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], subjectLabels: [], requests: [] });
});
await page.waitForTimeout(400);
check('the editor introduces itself when it first opens',
  await page.locator('.tour-bubble').isVisible());
check('over seven steps',
  (await page.locator('.tour-count').innerText()) === '1 of 7',
  await page.locator('.tour-count').innerText());
check('and leads with what it will never touch',
  (await page.locator('.tour-body').innerText()).includes('only ever read'));

// walking it should visit each tab in turn
const tabs = [];
for (let i = 1; i <= 7; i++) {
  tabs.push(await page.evaluate(() =>
    // the label carries its badge count — "Students 156"
    ((document.querySelector('.tabs button.active') || {}).textContent || '')
      .replace(/\s*\d+\s*$/, '').trim()));
  if (i < 7) { await page.click('.tour-next'); await page.waitForTimeout(350); }
}
check('each step brings its tab forward before pointing at it',
  tabs.join(' > ') === 'Students > Students > Teaching groups > Teachers > Requests > School files > Students',
  tabs.join(' > '));
check('every step after the first highlights something',
  await page.locator('.tour-ring').isVisible());
await page.click('.tour-next');
await page.waitForTimeout(250);
check('and it closes at the end', !(await page.locator('.tour-bubble').isVisible()));

await page.reload();
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: [], memberships: [],
    subjectKeys: d.subjectKeys, sources: [], teachers: [], subjectLabels: [], requests: [] });
});
await page.waitForTimeout(400);
check('it does not open again the next time the editor is used',
  !(await page.locator('.tour-bubble').isVisible()));
await page.click('#tourBtn');
await page.waitForTimeout(250);
check('the ? in the topbar brings it back',
  await page.locator('.tour-bubble').isVisible());
await page.click('.tour-skip');
await page.waitForTimeout(200);
check('Skip closes it from any step', !(await page.locator('.tour-bubble').isVisible()));

/* ---------- on a phone, and on anything short ----------
 * The card is fixed and covers the page, so if it grows past the screen its
 * own Skip and Next go below the fold with nothing left to scroll — and the
 * whole screen is dead. Every size has to keep them pressable. */
for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 480 },
  { width: 740, height: 360 }, { width: 1280, height: 800 }]) {
  const phone = await browser.newContext({ viewport: vp });
  const p2 = await phone.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto('file://' + demo + '/admin.html');
  await p2.waitForTimeout(300);
  await p2.evaluate(() => {
    const long = '<p>' + 'Internal messages within the leadership team are frequently ignored '
      .repeat(8) + '</p>';
    window.Tour.start([{ title: 'A long step', body: long, el: '#saveBtn' },
      { title: 'And a short one', body: '<p>short</p>' }]);
  });
  await p2.waitForTimeout(300);
  const fits = await p2.evaluate(() => {
    const card = document.querySelector('.tour-bubble').getBoundingClientRect();
    const next = document.querySelector('.tour-next').getBoundingClientRect();
    const skip = document.querySelector('.tour-skip').getBoundingClientRect();
    const body = document.querySelector('.tour-body');
    return {
      card: [Math.round(card.top), Math.round(card.bottom)],
      inside: card.top >= 0 && card.bottom <= innerHeight &&
        card.left >= 0 && card.right <= innerWidth,
      pressable: next.bottom <= innerHeight && next.top >= 0 &&
        skip.bottom <= innerHeight && skip.top >= 0,
      readable: body.scrollHeight <= body.clientHeight ||
        getComputedStyle(body).overflowY === 'auto',
    };
  });
  const size = vp.width + 'x' + vp.height;
  check(size + ': the card stays on the screen', fits.inside, fits.card.join('..'));
  check(size + ': Skip and Next stay pressable', fits.pressable);
  check(size + ': and a long step scrolls inside the card', fits.readable);
  // a real tap, not a scripted click: proof nothing is covering them
  await p2.locator('.tour-next').click();
  await p2.waitForTimeout(250);
  check(size + ': pressing Next moves on', (await p2.locator('.tour-count').innerText()) === '2 of 2');
  await p2.locator('.tour-skip').click();
  await p2.waitForTimeout(200);
  check(size + ': and Skip closes it', await p2.locator('.tour').isHidden());
  await phone.close();
}

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All walk-through checks passed');
process.exit(failures.length ? 1 : 0);
