/* The Teaching groups table: search, three filters and click-a-header sorting.
 * Thirty-nine classes on the real data is more than a list to read down. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));

const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));

/* The sample is one level with a teacher on every class, so the fixture is
 * stretched: a second level, and two classes nobody has been given yet. */
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  const students = d.students.map((s) => Object.assign({}, s));
  students.slice(0, 40).forEach((s) => { s.level = 'Sec 2'; });
  const groups = d.groups.map((g) => Object.assign({}, g));
  groups[0] = Object.assign({}, groups[0], { level: 'Sec 2' });
  groups[1] = Object.assign({}, groups[1], { teachers: [] });
  groups[2] = Object.assign({}, groups[2], { teachers: [] });
  window.__loadModelForTest({ students, groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], subjectLabels: [], requests: [] });
});
await page.locator('.tabs button[data-tab="groups"]').click();
await page.waitForTimeout(300);

const col = (i) => page.locator('#groupsTable tbody tr td:nth-child(' + i + ')').allInnerTexts();
const rows = () => page.locator('#groupsTable tbody tr').count();
const all = await rows();

// --- sorting ---
check('every column header offers to sort by it',
  (await page.locator('#groupsTable thead th.sortable').count()) === 6,
  String(await page.locator('#groupsTable thead th.sortable').count()));
check('it opens sorted by subject, as it always was',
  (await page.locator('#groupsTable thead th.sorted-asc').innerText()).includes('SUBJECT'),
  await page.locator('#groupsTable thead th.sorted-asc').innerText());

await page.locator('#groupsTable thead th', { hasText: 'Members' }).click();
await page.waitForTimeout(150);
const asc = (await col(6)).map(Number);
check('Members sorts by size, as a number rather than as text',
  asc.every((n, i) => i === 0 || asc[i - 1] <= n), asc.slice(0, 6).join(','));
await page.locator('#groupsTable thead th', { hasText: 'Members' }).click();
await page.waitForTimeout(150);
const desc = (await col(6)).map(Number);
check('clicking the same header again turns it round',
  desc.every((n, i) => i === 0 || desc[i - 1] >= n) && desc[0] === asc[asc.length - 1],
  desc.slice(0, 6).join(','));
check('and the header says which way it is pointing',
  (await page.locator('#groupsTable thead th.sorted-desc').innerText()).includes('MEMBERS'));

await page.locator('#groupsTable thead th', { hasText: 'Teachers' }).click();
await page.waitForTimeout(150);
check('a class with no teacher sorts last, not first',
  (await col(3)).slice(-2).every((t) => t.trim() === ''),
  JSON.stringify((await col(3)).slice(-3)));

// --- filters ---
await page.locator('#groupsTable thead th', { hasText: 'Class' }).click();
await page.waitForTimeout(150);
await page.selectOption('#groupLevelFilter', 'Sec 2');
await page.waitForTimeout(200);
check('the level filter keeps only that level',
  (await rows()) > 0 && (await rows()) < all &&
  [...new Set(await col(4))].join(',') === 'Sec 2',
  (await rows()) + ' of ' + all + ' — ' + [...new Set(await col(4))].join(','));
await page.selectOption('#groupLevelFilter', '');

await page.selectOption('#groupSubjectFilter', 'Geography');
await page.waitForTimeout(200);
check('the subject filter keeps only that subject',
  (await rows()) > 0 && [...new Set(await col(2))].join(',') === 'Geography',
  [...new Set(await col(2))].join(','));
await page.selectOption('#groupSubjectFilter', '');

check('the teacher filter counts the classes nobody has been given yet',
  (await page.locator('#groupTeacherFilter option').nth(1).innerText()).includes('(2)'),
  await page.locator('#groupTeacherFilter option').nth(1).innerText());
await page.selectOption('#groupTeacherFilter', '__none');
await page.waitForTimeout(200);
check('and shows exactly those two',
  (await rows()) === 2 && (await col(3)).every((t) => t.trim() === ''),
  (await rows()) + ' rows');
await page.selectOption('#groupTeacherFilter', 'Mrs Lim Bee Leng');
await page.waitForTimeout(200);
check('a named teacher shows only their classes',
  (await rows()) > 0 && (await col(3)).every((t) => t.includes('Mrs Lim Bee Leng')),
  (await rows()) + ' rows');
await page.selectOption('#groupTeacherFilter', '');

// --- filters and search stack, and say so when nothing is left ---
await page.selectOption('#groupSubjectFilter', 'Geography');
await page.fill('#groupSearch', 'zzzz');
await page.waitForTimeout(200);
check('nothing left says so rather than looking like an empty app',
  (await rows()) === 0 && !(await page.locator('#groupsNoMatch').isHidden()) &&
  (await page.locator('#groupsEmpty').isHidden()));

// --- a class saved while a filter would hide it is not lost from view ---
await page.locator('#groupSearch').fill('English 1R1');
await page.selectOption('#groupSubjectFilter', '');
await page.waitForTimeout(200);
check('the search finds one class to edit', (await rows()) === 1, (await rows()) + ' rows');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.waitForSelector('#groupDialog[open]');
await page.fill('#gfName', 'Renamed Beyond The Search');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
check('renaming past the search clears it instead of the class vanishing',
  (await page.locator('#groupSearch').inputValue()) === '' && (await rows()) === all,
  '"' + (await page.locator('#groupSearch').inputValue()) + '", ' + (await rows()) + ' rows');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All groups-table checks passed');
process.exit(failures.length ? 1 : 0);
