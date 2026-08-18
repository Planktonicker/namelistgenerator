/* Coverage gaps, the "what changed" report, and pasting a staff list. */
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
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => d.accept());
await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => { const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [] }); });

// --- coverage: allocations with no class ---
const summary = await page.locator('#warningsList').innerText();
check('uncovered allocations are reported up front',
  /allocation\(s\) have no class/.test(summary), summary.split('\n')[0]);
await page.locator('#warningsList button', { hasText: 'Show me' }).click();
await page.waitForTimeout(200);
const gapRows = await page.locator('#warningsList li').count();
check('each gap is listed on its own, worst first (' + gapRows + ')', gapRows > 1);
check('a gap names the subject group, not the raw column',
  (await page.locator('#warningsList li').first().innerText()).includes('GEOG G3'),
  (await page.locator('#warningsList li').first().innerText()).split('\n')[0]);

// making the class straight from the gap
await page.locator('#warningsList button', { hasText: 'Make a class for them' }).first().click();
await page.waitForSelector('#groupDialog[open]');
check('the class dialog opens with that subject group ticked',
  (await page.locator('#gfKeyTicks label.on').innerText()).startsWith('GEOG') &&
  (await page.locator('#gfValueTicks label.on').innerText()).includes('GEOG G3'),
  (await page.locator('#gfKeyTicks label.on').innerText()).replace(/\s+/g, ' '));
check('and with those students already selected',
  (await page.locator('#groupDialogTitle').innerText()).includes('78 selected'),
  await page.locator('#groupDialogTitle').innerText());
check('the class is named for you, so OK is all that is left',
  (await page.locator('#gfName').inputValue()).includes('GEOG G3'),
  await page.locator('#gfName').inputValue());
check('the class code is the name — not a second thing to fill in',
  (await page.locator('#gfCodeRow').isHidden()) &&
  (await page.locator('#gfCode').inputValue()) === (await page.locator('#gfName').inputValue()));
await page.selectOption('#gfTeacher', { index: 1 });   // 0 is the “pick a teacher” placeholder
await page.click('#gfTeacherAdd');
await page.click('#groupForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('groupDialog').open);
await page.waitForTimeout(400);
const after = await page.locator('#warningsList').innerText();
check('closing a gap removes it from the list', !after.includes('GEOG G3'),
  after.split('\n')[0]);

// --- what changed: run a level update against an edited file ---
await page.evaluate(() => {
  const m = window.__testModel();
  const imported = m.students.filter((s) => s.class === '1R1').map((s) => ({
    name: s.name, class: s.name.startsWith('Grace') ? '1R2' : s.class, level: s.level,
    gender: s.gender, pg: s.pg, tg: s.tg,
    subjects: Object.assign({}, s.subjects, s.name.startsWith('Hakim') ? { HIST: 'HIST G1' } : {}),
  }));
  imported.push({ name: 'New Transfer', class: '1R1', level: s0(), gender: 'F', pg: '3', tg: 'SG1',
    subjects: { EL: 'EL G3' } });
  function s0() { return m.students[0].level; }
  window.__lastReport = window.NamelistSchema.applyLevelUpdate(m, imported, ['EL', 'HIST']);
});
const changes = await page.evaluate(() => window.__lastReport.changes.map((c) => c.kind + '|' + c.text));
check('an update records the moves, band changes and arrivals',
  changes.some((c) => c.startsWith('moved|')) &&
  changes.some((c) => c.startsWith('subject|')) &&
  changes.some((c) => c.startsWith('added|')),
  changes.slice(0, 3).join(' ; '));

// --- paste a staff list ---
await page.locator('.tabs button[data-tab="teachers"]').click();
const before = await page.locator('#teachersTable tbody tr').count();
await page.click('#pasteTeachersBtn');
await page.waitForSelector('#pasteTeachersDialog[open]');
await page.fill('#pasteTeachersBox',
  '1. Mrs Wong Mei Ling\nMr Tan Boon Huat,\n\nMdm Siti Nurhaliza\nMrs Wong Mei Ling\n');
await page.waitForTimeout(150);
check('the dialog counts what it will actually add',
  (await page.locator('#pasteTeachersNote').innerText()).startsWith('3 new name(s) of 4 line(s)'),
  await page.locator('#pasteTeachersNote').innerText());
await page.click('#pasteTeachersForm button[type="submit"]');
await page.waitForTimeout(300);
check('pasted names land on the roster, numbering stripped',
  (await page.locator('#teachersTable tbody tr').count()) === before + 3 &&
  (await page.locator('#teachersTable').innerText()).includes('Mrs Wong Mei Ling'));
check('a repeat paste adds nobody twice', await (async () => {
  await page.click('#pasteTeachersBtn');
  await page.fill('#pasteTeachersBox', 'Mrs Wong Mei Ling');
  await page.waitForTimeout(150);
  const note = await page.locator('#pasteTeachersNote').innerText();
  await page.click('#pasteTeachersCancel');
  return note.startsWith('0 new name(s)');
})());

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All coverage/changes checks passed');
process.exit(failures.length ? 1 : 0);
