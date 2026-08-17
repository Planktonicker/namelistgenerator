/* Undo in the editor: what it covers, how far back it goes, and the one
 * place it deliberately refuses to reach — past another admin's changes. */
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
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], subjectLabels: [], requests: [] });
});
await page.locator('.tabs button[data-tab="students"]').click();

const count = () => page.locator('#countStudents').innerText();
const nameOf = (id) => page.evaluate((i) =>
  window.__testModel().students.filter((s) => s.id === i)[0].name, id);

check('nothing to undo on a fresh model', await page.locator('#undoBtn').isDisabled());
check('and nothing to redo', await page.locator('#redoBtn').isDisabled());

/* ---------- an edit ---------- */
const firstId = await page.locator('#studentsTable tbody tr').first().getAttribute('data-id');
const before = await nameOf(firstId);
await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
await page.fill('#sfName', 'WRONGLY TYPED NAME');
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('the edit landed', (await nameOf(firstId)) === 'WRONGLY TYPED NAME');
check('undo is now offered, and says what it will undo',
  !(await page.locator('#undoBtn').isDisabled()) &&
  /student edit/.test(await page.locator('#undoBtn').getAttribute('title')),
  await page.locator('#undoBtn').getAttribute('title'));

await page.click('#undoBtn');
await page.waitForTimeout(200);
check('undo puts the name back', (await nameOf(firstId)) === before, await nameOf(firstId));
check('and offers to redo it',
  !(await page.locator('#redoBtn').isDisabled()) &&
  /student edit/.test(await page.locator('#redoBtn').getAttribute('title')));
await page.click('#redoBtn');
await page.waitForTimeout(200);
check('redo puts the edit back', (await nameOf(firstId)) === 'WRONGLY TYPED NAME');
await page.click('#undoBtn');
await page.waitForTimeout(200);

/* ---------- a deletion, which is what undo is really for ---------- */
const startCount = await count();
await page.locator('#studentsTable tbody tr').first().locator('button[data-act="del"]').click();
await page.waitForTimeout(300);
check('the student is gone', (await count()) === String(+startCount - 1));
const groupsBefore = await page.evaluate((i) =>
  window.__testModel().memberships.filter((m) => m.studentId === i).length, firstId);
check('and so are their class places', groupsBefore === 0);

await page.keyboard.press('Control+z');
await page.waitForTimeout(300);
check('Ctrl+Z brings the student back', (await count()) === startCount, await count());
check('with their classes', (await page.evaluate((i) =>
  window.__testModel().memberships.filter((m) => m.studentId === i).length, firstId)) > 0);
check('and their name', (await nameOf(firstId)) === before);

/* ---------- several steps back ---------- */
// by id, not by row: moving their class re-sorts the table under them
const row = '#studentsTable tbody tr[data-id="' + firstId + '"] ';
for (const cls of ['1R2', '1R3', '1R4']) {
  await page.locator(row + 'button.namelink').click();
  await page.waitForSelector('#studentDialog[open]');
  await page.selectOption('#sfClass', cls);
  await page.click('#studentForm button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('studentDialog').open);
}
const classOf = () => page.evaluate((i) =>
  window.__testModel().students.filter((s) => s.id === i)[0].class, firstId);
check('three moves later they are in 1R4', (await classOf()) === '1R4');
await page.click('#undoBtn');
await page.click('#undoBtn');
await page.waitForTimeout(300);
check('two undos walk back through them', (await classOf()) === '1R2', await classOf());
await page.click('#undoBtn');
await page.waitForTimeout(300);
check('and a third returns to where they started', (await classOf()) === '1R1', await classOf());

/* ---------- a new change discards the redo trail ---------- */
check('redo is available after undoing', !(await page.locator('#redoBtn').isDisabled()));
await page.locator(row + 'button[data-act="del"]').click();   // any fresh change
await page.waitForTimeout(300);
check('making something new drops the redo trail',
  await page.locator('#redoBtn').isDisabled());
await page.click('#undoBtn');            // put them back before carrying on
await page.waitForTimeout(300);

/* ---------- undo does not reach past another admin's work ---------- */
await page.evaluate(() => {
  const m = window.__testModel();
  const theirs = window.NamelistSchema.cloneModel(m);
  theirs.students.push({ id: 'THEIRS-9', name: 'THEIR STUDENT', class: '1R1', level: '1',
    gender: 'F', pg: '3', tg: '', sn: '', origin: 'added', sourceName: 'THEIR STUDENT',
    status: '', subjects: {} });
  // what a sync merge does when the other admin has saved
  const out = window.NamelistSchema.mergeModels(m, m, theirs);
  window.__mergeForTest(out);
});
await page.waitForTimeout(200);
check('their student arrived', await page.evaluate(() =>
  window.__testModel().students.some((s) => s.id === 'THEIRS-9')));
check('undo is withdrawn rather than risk reverting their work',
  await page.locator('#undoBtn').isDisabled());
check('and it says why',
  /another admin/i.test(await page.locator('#undoBtn').getAttribute('title')),
  await page.locator('#undoBtn').getAttribute('title'));

// but it starts collecting again from here
const beforeDelete = await count();
await page.locator('#studentsTable tbody tr').first().locator('button[data-act="del"]').click();
await page.waitForTimeout(300);
check('a change after the merge is undoable again',
  !(await page.locator('#undoBtn').isDisabled()));
await page.click('#undoBtn');
await page.waitForTimeout(300);
check('undo works again for what happens next', (await count()) === beforeDelete,
  (await count()) + ' vs ' + beforeDelete);
check('and their student is still there', await page.evaluate(() =>
  window.__testModel().students.some((s) => s.id === 'THEIRS-9')));

/* ---------- Ctrl+Z inside a text box is the browser's, not ours ---------- */
await page.fill('#studentSearch', 'Aiden');
await page.locator('#studentSearch').focus();
const undoDepthBefore = await page.evaluate(() => window.__undoDepthForTest());
await page.keyboard.press('Control+z');
await page.waitForTimeout(200);
check('Ctrl+Z in a search box does not undo the data',
  (await page.evaluate(() => window.__undoDepthForTest())) === undoDepthBefore);
await page.fill('#studentSearch', '');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All undo checks passed');
process.exit(failures.length ? 1 : 0);
