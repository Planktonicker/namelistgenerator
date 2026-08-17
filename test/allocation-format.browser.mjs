/* Drives dist/admin.html through the real ministry-format allocation file:
 * import -> discover classes -> tag teachers -> teacher page by level. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
/* A ministry-format allocation workbook to import. Point this at your own:
 *   ALLOCATION_XLSX=/path/to/2026_S3_Subject_Allocation.xlsx node test/allocation-format.browser.mjs
 * Expected counts below match the sanitized S3 file this was written against. */
const SRC = process.env.ALLOCATION_XLSX;
if (!SRC) {
  console.log('set ALLOCATION_XLSX to a subject-allocation workbook to run this test');
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), 'namelist-'));
const demo = join(scratch, 'moe');
mkdirSync(demo, { recursive: true });
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));
copyFileSync(join(repo, 'dist/namelist.html'), join(demo, 'namelist.html'));

const failures = [];
const check = (n, c, extra) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (extra ? ' [' + extra + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await page.goto('file://' + demo + '/admin.html');

// start from an empty folder-less model, then import the real file by hand
await page.evaluate(() => window.__loadModelForTest(
  { students: [], groups: [], memberships: [], subjectKeys: [], sources: [] }));
await page.locator('.tabs button[data-tab="sources"]').click();
await page.click('#addSourceBtn');
await page.fill('#srcLevel', 'Sec 3');
await page.click('#sourceForm button[type="submit"]');
const fc = page.waitForEvent('filechooser');
await page.locator('#sourcesTable button[data-act="update"]').click();
await (await fc).setFiles({
  name: '2026_S3_Subject_Allocation.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: readFileSync(SRC),
});
// first import of a level opens the column review; accept what it proposed
await page.waitForSelector('#mapDialog[open]');
await page.click('#mapGoBtn');
await page.waitForFunction(() => document.getElementById('dirtyNote').textContent.includes('Unsaved'));
check('imports all 190 students from the ministry file',
  (await page.locator('#countStudents').innerText()) === '190');

await page.locator('.tabs button[data-tab="students"]').click();
const headers = await page.locator('#studentsTable thead th').allInnerTexts();
check('subject columns are real subject names, not "Subject 1..20"',
  headers.some((h) => /english language/i.test(h)) && !headers.some((h) => /^subject \d+$/i.test(h)),
  headers.filter((h) => /english/i.test(h)).join(','));
check('Level column present', headers.some((h) => h.trim().toLowerCase() === 'level'));
await page.fill('#studentSearch', 'K200');
const k200rows = await page.locator('#studentsTable tbody tr').count();
check('searching a class code finds its students (' + k200rows + ')', k200rows === 62);
await page.fill('#studentSearch', '');

// discover the classes that already exist inside the data
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#discoverBtn');
await page.waitForFunction(() => document.getElementById('countGroups').textContent !== '0');
check('discovers the teaching classes in the file',
  (await page.locator('#countGroups').innerText()) === '50', await page.locator('#countGroups').innerText());
await page.fill('#groupSearch', 'K300');
const row = page.locator('#groupsTable tbody tr').first();
check('a discovered class is named from the cell, with its code beside it',
  (await row.innerText()).includes('English Language - G3') && (await row.innerText()).includes('K300'),
  (await row.innerText()).replace(/\s+/g, ' '));
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'K300');
check('K300 has all 82 students the file gives it',
  (await page.locator('#memCount').innerText()) === '82', await page.locator('#memCount').innerText());

// the two students with a blank Level must NOT be lost
await page.locator('.tabs button[data-tab="students"]').click();
await page.fill('#studentSearch', 'S3 _189');
const orphanGroups = await page.locator('#studentsTable tbody tr td:nth-last-child(2)').first().innerText();
check('a student with a blank Level cell is still in classes (' + orphanGroups + ')',
  parseInt(orphanGroups, 10) > 0);
await page.fill('#studentSearch', '');

// teachers go on the roster once, then get picked from a list
await page.locator('.tabs button[data-tab="teachers"]').click();
for (const name of ['Mrs Wong', 'Mr Tan']) {
  await page.click('#addTeacherBtn');
  await page.fill('#teachersTable input[data-edit]', name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}
check('both teachers are on the roster',
  (await page.locator('#teachersTable tbody tr').count()) === 2);

// tag two teachers onto one class, and one of them onto a second class
await page.locator('.tabs button[data-tab="groups"]').click();
await page.fill('#groupSearch', 'K300');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.selectOption('#gfTeacher', 'Mrs Wong');
await page.click('#gfTeacherAdd');
await page.selectOption('#gfTeacher', 'Mr Tan');
await page.click('#gfTeacherAdd');
check('two teachers can be tagged to one class',
  (await page.locator('#gfTeacherChips .chip').count()) === 2);
check('a school code is kept and shown, since the name does not carry it',
  !(await page.locator('#gfCodeRow').isHidden()) &&
  (await page.locator('#gfCode').inputValue()) === 'K300',
  await page.locator('#gfCode').inputValue());
check('the rule opens on its own column, already ticked',
  (await page.locator('#gfKeyTicks label.on').innerText()).includes('English Language') &&
  (await page.locator('#gfValueTicks label.on').count()) === 1,
  (await page.locator('#gfKeyTicks label.on').innerText()).replace(/\s+/g, ' '));
check('the mislabelled "Year" column was held back as an issue',
  (await page.locator('#warningsList').innerText()).includes('not a subject column'),
  (await page.locator('#warningsList').innerText()).split('\n')[0]);
await page.click('#groupForm button[type="submit"]');
await page.fill('#groupSearch', 'K341');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.selectOption('#gfTeacher', 'Mrs Wong');
await page.click('#gfTeacherAdd');
await page.click('#groupForm button[type="submit"]');
await page.fill('#groupSearch', '');

// publish and check the teacher view
const dataJs = await page.evaluate(() =>
  window.NamelistSchema.modelToDataJs(window.__testModel(), new Date().toISOString()));
const { writeFileSync } = await import('node:fs');
writeFileSync(join(demo, 'data.js'), dataJs);

const t = await ctx.newPage();
const tErr = [];
t.on('pageerror', (e) => tErr.push(String(e)));
await t.goto('file://' + demo + '/namelist.html');
await t.evaluate(() => localStorage.clear());
await t.reload();
await t.selectOption('#teacherSelect', 'Mrs Wong');
await t.waitForSelector('#teacherResults .card');
check('the teacher picks their name from a list, not free text',
  (await t.locator('#teacherSelect').evaluate((e) => e.tagName)) === 'SELECT');
check('their classes are chips they can narrow to',
  (await t.locator('#myClassChips button').count()) === 3,
  (await t.locator('#myClassChips').innerText()).replace(/\s+/g, ' '));
check('teacher sees only her own classes',
  (await t.locator('#teacherResults .card').count()) === 2);
check('classes are grouped under a level heading',
  (await t.locator('.level-head h3').first().innerText()).includes('Sec 3'),
  await t.locator('.level-head h3').first().innerText());
check('a co-taught class names the other teacher',
  (await t.locator('#teacherResults').innerText()).includes('with Mr Tan'));
const rows = await t.locator('#teacherResults .card').first().locator('tbody tr').count();
check('her namelist has the right students (' + rows + ')', rows === 82 || rows === 37);
// clicking a chip narrows the page to that one class
await t.locator('#myClassChips button').nth(1).click();
check('a chip shows just that class',
  (await t.locator('#teacherResults .card').count()) === 1);
await t.locator('#myClassChips button').first().click();

// the All classes tab lists every class, filterable
await t.click('#tabAllBtn');
const allText = await t.locator('#allCount').innerText();
check('All classes lists the whole school', /^5\d classes/.test(allText), allText);
await t.selectOption('#allTeacher', 'Mr Tan');
check('filtering by teacher narrows it',
  (await t.locator('#allResults .card').count()) === 1,
  await t.locator('#allCount').innerText());
await t.click('#allClear');
await t.fill('#allSearch', 'K341');
check('searching finds a class by its code',
  (await t.locator('#allResults .card').count()) === 1,
  await t.locator('#allCount').innerText());

check('teacher page: no JS errors', tErr.length === 0);
if (tErr.length) console.log(tErr);

check('admin page: no JS errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All ministry-format checks passed');
process.exit(failures.length ? 1 : 0);
