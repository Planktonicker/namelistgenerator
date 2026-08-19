/* The teacher page: pick your name from a list, chips for your classes, and a
 * browsable list of every class in the school. */
import { chromium } from 'playwright';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

check('three tabs: my namelists, every class, and the Excel export',
  (await page.locator('.tabs button').allInnerTexts()).join('|') ===
    'My namelists|All classes|Export to Excel',
  (await page.locator('.tabs button').allInnerTexts()).join('|'));

// --- tab 1: type-to-search the staff list, then chips ---
await page.click('#teacherOpen');
check('the arrow shows every teacher',
  (await page.locator('#teacherOptions li').count()) === 17,
  await page.locator('#teacherOptions li').count() + '');
await page.fill('#teacherSearch', 'lim');
await page.waitForTimeout(150);
const hits = await page.locator('#teacherOptions li').allInnerTexts();
check('typing part of a name narrows the list', hits.length === 2, hits.join(' | '));
check('a name you typed outranks the same letters inside another',
  hits[0] === 'Mrs Lim Bee Leng', hits[0]);
check('and the matching part is marked so it can be scanned',
  (await page.locator('#teacherOptions li').first().innerHTML()).includes('<mark>Lim</mark>'));
await page.fill('#teacherSearch', 'zzz');
await page.waitForTimeout(150);
check('a query nobody matches says so, rather than emptying silently',
  (await page.locator('#teacherOptions li.none').count()) === 1);
await page.fill('#teacherSearch', 'Mrs Lim Bee Leng');
await page.keyboard.press('Enter');
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
  (await page.locator('#teacherSearch').inputValue()) === 'Mrs Lim Bee Leng');

// the picker can also be driven entirely from the keyboard
await page.locator('#teacherSearch').focus();
await page.fill('#teacherSearch', 'teo');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('arrow keys and Enter choose without touching the mouse',
  (await page.locator('#teacherSearch').inputValue()) === 'Mr Benjamin Teo',
  await page.locator('#teacherSearch').inputValue());
check('and the list closes behind it', await page.locator('#teacherOptions').isHidden());

// half-typed text is not an answer
await page.fill('#teacherSearch', 'half typed rubbish');
await page.locator('#teacherSearch').blur();
await page.waitForTimeout(200);
check('leaving the box half-typed goes back to who is actually chosen',
  (await page.locator('#teacherSearch').inputValue()) === 'Mr Benjamin Teo',
  await page.locator('#teacherSearch').inputValue());
await page.locator('#teacherSearch').focus();
await page.fill('#teacherSearch', 'x');
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
/* Once somebody is chosen the box holds their name, and that name as a search
 * matches exactly one person. Looking up a colleague must not mean deleting
 * your own name first. */
await page.locator('#teacherSearch').blur();
await page.waitForTimeout(150);
await page.click('#teacherSearch');
await page.waitForTimeout(200);
check('clicking back into the box offers everybody, not just the one chosen',
  (await page.locator('#teacherOptions li').count()) === 17,
  (await page.locator('#teacherOptions li').count()) + ' shown');
check('with your own name still in the box, and ticked in the list',
  (await page.locator('#teacherSearch').inputValue()) === 'Mr Benjamin Teo' &&
  (await page.locator('#teacherOptions li[aria-selected]').innerText()).includes('Benjamin Teo'),
  await page.locator('#teacherSearch').inputValue());
check('the name is selected, so typing replaces it rather than appending',
  await page.evaluate(() => {
    const i = document.getElementById('teacherSearch');
    return i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value.length > 0;
  }));
check('and the keyboard starts on you, not at the top of the staff list',
  (await page.locator('#teacherOptions li.active').innerText()).includes('Benjamin Teo'),
  await page.locator('#teacherOptions li.active').innerText());
await page.keyboard.type('Sarah');
await page.waitForTimeout(200);
check('typing over it filters again',
  (await page.locator('#teacherOptions li').count()) === 1 &&
  (await page.locator('#teacherSearch').inputValue()) === 'Sarah',
  await page.locator('#teacherSearch').inputValue());
await page.locator('#teacherOptions li').first().click();
await page.waitForTimeout(300);
check('and picking from it switches teacher',
  (await page.locator('#teacherSearch').inputValue()) === 'Dr Sarah Loh',
  await page.locator('#teacherSearch').inputValue());
await page.locator('#teacherSearch').blur();
await page.waitForTimeout(150);
await page.locator('#teacherSearch').focus();
await page.fill('#teacherSearch', 'Mr Benjamin Teo');
await page.waitForTimeout(150);
await page.locator('#teacherSearch').blur();
await page.waitForTimeout(250);

await page.locator('#teacherSearch').focus();
await page.fill('#teacherSearch', 'x');
await page.waitForTimeout(150);
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
check('Escape abandons what you were typing', 
  (await page.locator('#teacherSearch').inputValue()) === 'Mr Benjamin Teo');
await page.fill('#teacherSearch', 'Mrs Lim Bee Leng');
await page.keyboard.press('Enter');
await page.waitForSelector('#teacherResults .card');

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

/* The data file sits beside this page in a flat folder, and in Data\ in the
 * tidier one. Both have to work, because a folder is one or the other. */
const tidy = mkdtempSync(join(tmpdir(), 'namelist-tidy-'));
mkdirSync(join(tidy, 'Data'));
copyFileSync(join(repo, 'dist/namelist.html'), join(tidy, 'namelist.html'));
copyFileSync(join(repo, 'sample/data.js'), join(tidy, 'Data', 'data.js'));
const tidyPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
tidyPage.on('pageerror', (e) => errors.push(String(e)));
await tidyPage.goto('file://' + tidy + '/namelist.html');
await tidyPage.waitForTimeout(400);
check('the page finds its data in a Data folder, with nothing beside it',
  !(await tidyPage.locator('#app').isHidden()) &&
  (await tidyPage.locator('#errorState').isHidden()));
check('and reads the same roll from there',
  (await tidyPage.locator('#teacherOptions li').count()) === 0 &&
  (await tidyPage.evaluate(() => window.NAMELIST_DATA.students.length)) === 156,
  await tidyPage.evaluate(() => window.NAMELIST_DATA.students.length) + '');
await tidyPage.close();

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All teacher-page checks passed');
process.exit(failures.length ? 1 : 0);
