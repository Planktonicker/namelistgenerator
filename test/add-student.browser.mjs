/* Adding a student: the level is answered first and everything else is a
 * dropdown drawn from that level. */
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
const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
// two levels in one model: a Sec 4 cohort taking POA, and the sample's Sec 1
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  const students = d.students.map((s, i) => i % 3 === 0
    ? { ...s, level: 'Sec 4', class: '4E' + ((i % 6) + 1), tg: 'SG' + ((i % 6) + 1),
        subjects: { EL: 'EL G2', POA: 'POA G2' } }
    : { ...s, level: 'Sec 1' });
  window.__loadModelForTest({ students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys.concat(['POA']), sources: [], teachers: [] });
});

await page.click('#addStudentBtn');
await page.waitForSelector('#studentDialog[open]');
const fields = await page.locator('#studentForm label').allInnerTexts();
check('the level is asked before anything it decides',
  fields.indexOf('Level') < fields.indexOf('Class') &&
  fields.indexOf('Level') < fields.indexOf('PG'), fields.slice(0, 6).join(' → '));
check('class, gender, PG and TG/SG are all dropdowns',
  (await page.locator('#sfClass').evaluate((e) => e.tagName)) === 'SELECT' &&
  (await page.locator('#sfGender').evaluate((e) => e.tagName)) === 'SELECT' &&
  (await page.locator('#sfPg').evaluate((e) => e.tagName)) === 'SELECT' &&
  (await page.locator('#sfTg').evaluate((e) => e.tagName)) === 'SELECT');

await page.selectOption('#sfLevel', 'Sec 4');
const s4classes = await page.locator('#sfClass option').allInnerTexts();
check('the classes are that level\'s classes',
  s4classes.some((c) => c.startsWith('4E')) && !s4classes.some((c) => c.startsWith('1R')),
  s4classes.join(','));
const s4subjects = await page.locator('#sfSubjects label').allInnerTexts();
check('so are the subjects', s4subjects.includes('POA') && !s4subjects.includes('HIST'),
  s4subjects.join(','));
check('and each subject offers that level\'s groups',
  (await page.locator('#sfSubjects select').first().locator('option').allInnerTexts())
    .join(',') === '— not taking —,EL G2',
  (await page.locator('#sfSubjects select').first().locator('option').allInnerTexts()).join(','));
check('a class that does not exist yet can still be entered',
  s4classes.includes('Other…'));

await page.selectOption('#sfLevel', 'Sec 1');
const s1classes = await page.locator('#sfClass option').allInnerTexts();
check('switching level swaps the classes, keeping nothing stale',
  s1classes.some((c) => c.startsWith('1R')) && !s1classes.some((c) => c.startsWith('4E')),
  s1classes.join(','));
check('and swaps the subjects',
  (await page.locator('#sfSubjects label').allInnerTexts()).includes('HIST'));

await page.selectOption('#sfClass', '1R2');
check('the student ID follows the class', /^1R2-\d+$/.test(await page.locator('#sfId').inputValue()),
  await page.locator('#sfId').inputValue());
await page.fill('#sfName', 'Late Transfer');
await page.selectOption('#sfPg', '3');
await page.selectOption('#sfTg', { index: 1 });
await page.selectOption('#sfSubjects select >> nth=0', 'EL G3');
await page.click('#studentForm button[type="submit"]');
await page.waitForTimeout(300);
const saved = await page.evaluate(() =>
  window.__testModel().students.find((s) => s.name === 'Late Transfer'));
check('the student is saved with what was picked',
  saved && saved.class === '1R2' && saved.pg === '3' && saved.level === 'Sec 1' &&
  saved.subjects.EL === 'EL G3' && !!saved.tg, JSON.stringify(saved));
check('and is marked as added here, not from the school file', saved.origin === 'added');

// editing keeps their own values even when the level has moved on
await page.fill('#studentSearch', 'Late Transfer');
await page.locator('#studentsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.waitForSelector('#studentDialog[open]');
check('editing shows their current answers',
  (await page.locator('#sfClass').inputValue()) === '1R2' &&
  (await page.locator('#sfPg').inputValue()) === '3' &&
  (await page.locator('#sfSubjects select').first().inputValue()) === 'EL G3');
await page.click('#studentCancelBtn');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All add-student checks passed');
process.exit(failures.length ? 1 : 0);
