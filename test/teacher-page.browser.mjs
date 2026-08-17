/* The teacher page: pick your name from a list, chips for your classes, and a
 * browsable list of every class in the school. */
import { chromium } from 'playwright';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/namelist.html'), join(demo, 'namelist.html'));
/* The sample gives every teacher one class; this page is about the teacher who
 * has several, so one of them is given a second class here. */
const dataJs = readFileSync(join(repo, 'sample/data.js'), 'utf8');
const win = {};
new Function('window', dataJs)(win);
const second = win.NAMELIST_DATA.groups.find((g) => g.code === 'MA-1R4');
second.teachers = second.teachers.concat(['Mrs Lim Bee Leng']);
/* One long name in the English class, to watch the Name column follow it. */
const inEnglish = win.NAMELIST_DATA.memberships.find((m) => m.groupCode === 'EL-1R1');
win.NAMELIST_DATA.students.find((s) => s.id === inEnglish.studentId).name =
  'NURUL AISYAH BINTE MOHAMED FAIZAL RAHMAN';
writeFileSync(join(demo, 'data.js'),
  'window.NAMELIST_DATA = ' + JSON.stringify(win.NAMELIST_DATA) + ';\n');

const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1150, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + demo + '/namelist.html');
await page.evaluate(() => localStorage.clear());
await page.reload();

check('two tabs: my namelists and every class',
  (await page.locator('.tabs button').allInnerTexts()).join('|') === 'My namelists|All classes');

// --- tab 1: a dropdown of teachers, then chips ---
check('teachers are chosen from a dropdown, not typed',
  (await page.locator('#teacherSelect').evaluate((e) => e.tagName)) === 'SELECT' &&
  (await page.locator('#teacherSelect option').count()) === 18);
await page.selectOption('#teacherSelect', 'Mrs Lim Bee Leng');
await page.waitForSelector('#teacherResults .card');
const chips = await page.locator('#myClassChips button').allInnerTexts();
check('their classes come back as chips, plus an "all" chip',
  chips.length === 3 && chips[0].startsWith('All 2 classes'), chips.join(' / '));
const allCards = await page.locator('#teacherResults .card').count();
check('every namelist is shown to begin with', allCards === 2);
await page.locator('#myClassChips button').nth(1).click();
check('clicking a chip narrows the page to that class',
  (await page.locator('#teacherResults .card').count()) === 1 &&
  (await page.locator('#myClassChips button.on').count()) === 1,
  await page.locator('#myClassChips button.on').innerText());
await page.locator('#myClassChips button').first().click();
check('the "all" chip puts them back', (await page.locator('#teacherResults .card').count()) === 2);

// the namelist is the school's layout, with the Name column sized to its names
const cols = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll('#teacherResults .card'));
  return cards.map((card) => {
    const row = card.querySelector('.namelist tbody tr');
    const cell = (cls) => Math.round(card.querySelector('.' + cls).getBoundingClientRect().width);
    const longest = Math.max(...Array.from(card.querySelectorAll('.nl-name')).map((c) => c.scrollWidth));
    return { head: card.querySelector('.namelist thead').innerText.replace(/\s+/g, ' ').trim(),
      name: cell('nl-name'), note: cell('nl-note'), longest: longest, cells: row.children.length };
  });
});
check('the namelist carries the school\'s columns',
  cols.every((c) => c.head === 'S/N Class Name Gender Note' && c.cells === 5), cols[0].head);
check('the Name column is as wide as its longest name, plus a margin',
  cols.every((c) => c.name >= c.longest && c.name <= c.longest + 40),
  cols.map((c) => c.name + ' vs ' + c.longest).join(' / '));
check('a class of short names gets a narrow Name column, and Note takes the rest',
  Math.min.apply(null, cols.map((c) => c.name)) < Math.max.apply(null, cols.map((c) => c.name)) &&
  cols.every((c) => c.note > 110),
  cols.map((c) => 'name ' + c.name + ', note ' + c.note).join(' / '));

// the choice is remembered for next time
await page.reload();
await page.waitForSelector('#teacherResults .card');
check('the page remembers who you are',
  (await page.locator('#teacherSelect').inputValue()) === 'Mrs Lim Bee Leng');

// --- tab 2: every class, filterable ---
await page.click('#tabAllBtn');
const total = await page.locator('#allCount').innerText();
check('all classes are listed', /^16 classes/.test(total), total);
check('a class is a summary until you open it',
  (await page.locator('#allResults .card').count()) === 16 &&
  (await page.locator('#allResults tbody tr').count()) === 0);
await page.locator('#allResults button[data-open]').first().click();
check('opening one shows its namelist',
  (await page.locator('#allResults tbody tr').count()) > 0);

await page.selectOption('#allSubject', 'Mathematics');
check('filtering by subject narrows the list',
  (await page.locator('#allResults .card').count()) === 6,
  await page.locator('#allCount').innerText());
await page.selectOption('#allLevel', '1');
check('level and subject combine',
  (await page.locator('#allResults .card').count()) === 6);
await page.click('#allClear');
check('Clear puts everything back', (await page.locator('#allResults .card').count()) === 16);

await page.selectOption('#allTeacher', 'Mrs Lim Bee Leng');
check('filtering by teacher works too',
  (await page.locator('#allResults .card').count()) === 2,
  await page.locator('#allCount').innerText());
await page.click('#allClear');

await page.fill('#allSearch', 'Mathematics 1R4');
check('searching by class name works',
  (await page.locator('#allResults .card').count()) === 1);
await page.fill('#allSearch', 'Grace Koh');
check('a student name finds the classes that student is in',
  (await page.locator('#allResults .card').count()) > 1 &&
  (await page.locator('#allCount').innerText()).includes('that student is in'),
  await page.locator('#allCount').innerText());
check('and says which student matched',
  (await page.locator('#allResults .card').first().innerText()).includes('Grace Koh'));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All teacher-page checks passed');
process.exit(failures.length ? 1 : 0);
