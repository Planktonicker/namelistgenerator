/* Opening a student from the Students tab and changing their name or subject,
 * with the namelists following the change. */
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
let asked = [];
let answer = '';
page.on('dialog', (d) => {
  asked.push(d.message());
  if (d.type() === 'prompt') d.accept(answer);
  else d.accept();
});

await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], requests: [] });
});
await page.locator('.tabs button[data-tab="students"]').click();

/* ---------- opening it ---------- */

const firstId = await page.locator('#studentsTable tbody tr').first().getAttribute('data-id');
await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
check('clicking the name opens that student', true);
check('and does not also select the row',
  (await page.locator('#studentsTable tbody tr.selected').count()) === 0);
await page.click('#studentCancelBtn');

await page.locator('#studentsTable tbody tr').first().dblclick();
await page.waitForSelector('#studentDialog[open]');
check('double-clicking the row opens it too',
  (await page.locator('#sfName').inputValue()).length > 0,
  await page.locator('#sfName').inputValue());

/* ---------- the name ---------- */

const was = await page.locator('#sfName').inputValue();
const snBefore = await page.evaluate((id) =>
  window.__testModel().students.filter((e) => e.id === id)[0].sn, firstId);
await page.fill('#sfName', 'corrected full name');
check('the name box forces capitals as you type',
  (await page.locator('#sfName').inputValue()) === 'CORRECTED FULL NAME');
check('it says the file\'s own spelling is what future updates match on',
  /matches on/i.test(await page.locator('#studentDialog').innerText()));
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
const renamed = await page.evaluate((id) => {
  const s = window.__testModel().students.filter((e) => e.id === id)[0];
  return { name: s.name, sourceName: s.sourceName, sn: s.sn };
}, firstId);
check('the corrected name is stored', renamed.name === 'CORRECTED FULL NAME', renamed.name);
check('and the office S/N — which this form never shows — survives the edit',
  renamed.sn === snBefore && snBefore !== '', 'was ' + snBefore + ', now ' + renamed.sn);
check('and the file\'s spelling is kept alongside it, for matching',
  renamed.sourceName === was, renamed.sourceName);
const renamedRow = await page.locator('#studentsTable tbody tr[data-id="' + firstId + '"]').innerText();
check('the table shows the correction, marked as edited',
  renamedRow.includes('CORRECTED FULL NAME') && renamedRow.includes('edited'),
  renamedRow.replace(/\s+/g, ' ').slice(0, 60));

/* ---------- a subject, and the namelists that follow it ---------- */

// find a student in a rule-built class, and the class's own subject column
const target = await page.evaluate(() => {
  const m = window.__testModel();
  const g = m.groups.filter((x) => window.NamelistSchema.groupHasRule(x) &&
    window.NamelistSchema.matchers(x).length)[0];
  const key = window.NamelistSchema.matchers(g)[0].key;
  const member = m.memberships.filter((x) => x.groupCode === g.code)[0];
  const s = m.students.filter((e) => e.id === member.studentId)[0];
  return { code: g.code, name: g.name || g.code, key, sid: s.id, sname: s.name,
    value: s.subjects[key] };
});
await page.fill('#studentSearch', target.sname);
await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
const subjSel = '#sfSubjects select[data-subj="' + target.key + '"]';
check('the dialog has a Subjects section listing that column',
  (await page.locator(subjSel).count()) === 1 &&
  /^subjects$/i.test(await page.locator('#sfSubjects .subhead').innerText()),
  await page.locator('#sfSubjects .subhead').innerText());
check('their current allocation is selected',
  (await page.locator(subjSel).inputValue()) === target.value, target.value);

// take them out of that allocation entirely
asked = [];
await page.selectOption(subjSel, '');
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('dropping a subject offers to take them off that namelist',
  asked.some((m) => /no longer matches/.test(m)),
  (asked[0] || '').split('\n')[0]);
check('and it happens', await page.evaluate((t) => {
  const m = window.__testModel();
  return !m.memberships.some((x) => x.studentId === t.sid && x.groupCode === t.code);
}, target));

// put them back by choosing the allocation again
await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
await page.selectOption(subjSel, target.value);
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('choosing it again puts them back on the namelist', await page.evaluate((t) => {
  const m = window.__testModel();
  return m.memberships.some((x) => x.studentId === t.sid && x.groupCode === t.code);
}, target));

/* ---------- a value this level has never used ---------- */

await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
const optionsBefore = await page.locator(subjSel + ' option').allInnerTexts();
check('every allocation the level uses is offered, plus a way in for a new one',
  optionsBefore.some((o) => /Other/.test(o)), optionsBefore.join(' | ').slice(0, 90));
answer = 'HIST G9 - X999';
await page.selectOption(subjSel, '__other');
await page.waitForTimeout(200);
check('picking Other lets you type what the file calls it',
  (await page.locator(subjSel).inputValue()) === 'HIST G9 - X999',
  await page.locator(subjSel).inputValue());
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('and it is stored as typed', await page.evaluate((t) => {
  const s = window.__testModel().students.filter((e) => e.id === t.sid)[0];
  return s.subjects[t.key] === 'HIST G9 - X999';
}, target));

/* ---------- a subject column this level does not use ---------- */

await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
await page.waitForSelector('#studentDialog[open]');
const spare = await page.evaluate(() => {
  const shown = Array.from(document.querySelectorAll('#sfSubjects select[data-subj]'))
    .map((s) => s.dataset.subj);
  return (window.__testModel().subjectKeys || []).filter((k) => shown.indexOf(k) === -1)[0] || '';
});
check('columns the level does not use are offered under "Another subject"',
  (await page.locator('#sfAddSubject option').count()) >= 2,
  spare || '(all columns already shown)');
if (spare) {
  await page.selectOption('#sfAddSubject', spare);
  await page.waitForTimeout(200);
  check('picking one adds it to the form',
    (await page.locator('#sfSubjects select[data-subj="' + spare + '"]').count()) === 1);
  check('and the subjects already answered are still answered',
    (await page.locator(subjSel).inputValue()) === 'HIST G9 - X999',
    await page.locator(subjSel).inputValue());
}
answer = 'DRAMA';
await page.selectOption('#sfAddSubject', '__new');
await page.waitForTimeout(200);
check('a column that does not exist at all can be created here',
  (await page.locator('#sfSubjects select[data-subj="DRAMA"]').count()) === 1);
await page.selectOption('#sfSubjects select[data-subj="DRAMA"]', '__other');
answer = 'DRAMA G2';
await page.waitForTimeout(200);
await page.selectOption('#sfSubjects select[data-subj="DRAMA"]', '__other');
await page.waitForTimeout(200);
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('the new column and its value are stored', await page.evaluate((t) => {
  const m = window.__testModel();
  const s = m.students.filter((e) => e.id === t.sid)[0];
  return m.subjectKeys.includes('DRAMA') && s.subjects.DRAMA === 'DRAMA G2';
}, target));
check('and it becomes a column in the table',
  (await page.locator('#studentsTable thead').innerText()).includes('DRAMA'));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (process.env.SHOT) {
  await page.locator('#studentsTable tbody tr').first().locator('button.namelink').click();
  await page.waitForSelector('#studentDialog[open]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All edit-student checks passed');
process.exit(failures.length ? 1 : 0);
