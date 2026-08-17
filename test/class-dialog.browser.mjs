import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));
const failures = [];
const check = (n, c, x) => { console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : '')); if (!c) failures.push(n); };
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Cheng Xin Ze') : d.accept()));
const addTeacher = async (name) => {
  await page.click('#addTeacherBtn');
  await page.fill('#teachersTable input[data-edit]', name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
};
await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => { const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [] }); });

// --- Teachers tab ---
await page.locator('.tabs button[data-tab="teachers"]').click();
const roster = await page.locator('#teachersTable tbody tr').count();
check('Teachers tab lists everyone already tagged (' + roster + ')', roster === 17);
check('it shows which classes each one has',
  (await page.locator('#teachersTable').innerText()).includes('English 1R1'));
await addTeacher('Cheng Xin Ze');
check('a new teacher can be added to the roster',
  (await page.locator('#teachersTable tbody tr').count()) === 18);
check('the name is typed into the list, not a pop-up',
  (await page.locator('#teachersTable').innerText()).includes('Cheng Xin Ze'));

// the name itself is the edit control, and saving asks first
await page.locator('#teachersTable tbody tr', { hasText: 'Cheng Xin Ze' })
  .locator('button[data-act="edit"]').click();
await page.fill('#teachersTable input[data-edit]', 'Cheng Xin Ze (Ms)');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
check('clicking a name edits it in place',
  (await page.locator('#teachersTable').innerText()).includes('Cheng Xin Ze (Ms)'));
await page.locator('#teachersTable tbody tr', { hasText: 'Cheng Xin Ze (Ms)' })
  .locator('button[data-act="edit"]').click();
await page.fill('#teachersTable input[data-edit]', 'Cheng Xin Ze');
await page.keyboard.press('Enter');
await page.waitForTimeout(200);

// --- class dialog ---
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
check('teachers are PICKED, not typed',
  (await page.locator('#gfTeacher').evaluate((e) => e.tagName)) === 'SELECT');
check('the new teacher is in the picker',
  (await page.locator('#gfTeacher option').allInnerTexts()).includes('Cheng Xin Ze'));
check('the rule starts as a level branch and nothing else',
  (await page.locator('#gfLevelTicks label').count()) > 1 &&
  (await page.locator('#gfValueRow').isHidden()),
  (await page.locator('#gfLevelTicks').innerText()).replace(/\s+/g, ' '));
await page.locator('#gfLevelTicks label').filter({ hasText: /^1\b/ }).first().click();
await page.click('#gfMoreBtn');
check('PG is a tick list, with no PG2-style labels',
  (await page.locator('#gfPgTicks label').allInnerTexts()).every((t) => /^[123]\b/.test(t.trim())),
  (await page.locator('#gfPgTicks').innerText()).replace(/\s+/g, ' '));
check('classes are ticked, not typed',
  (await page.locator('#gfClassTicks label').count()) > 0 &&
  (await page.locator('#gfClassTicks').innerText()).includes('1R1'));
check('TG/SG is its own branch, not a subject column',
  (await page.locator('#gfKeyTicks label').allInnerTexts()).every((t) => !/^(TG|SG)\b/.test(t.trim())) &&
  (await page.locator('#gfTgTicks label').count()) > 0,
  (await page.locator('#gfTgTicks').innerText()).replace(/\s+/g, ' '));

// build the class the screenshot was attempting: HIST G3 students in TG2
await page.selectOption('#gfTeacher', 'Cheng Xin Ze');
await page.click('#gfTeacherAdd');
check('the group branch is closed until a subject is picked',
  await page.locator('#gfValueRow').isHidden());
await page.locator('#gfKeyTicks label').filter({ hasText: /^HIST\b/ }).first().click();
check('picking a subject opens its groups',
  !(await page.locator('#gfValueRow').isHidden()) &&
  (await page.locator('#gfValueTicks').innerText()).includes('HIST G3'));
await page.locator('#gfValueTicks label', { hasText: 'HIST G3' }).first().click();
await page.locator('#gfTgTicks label').filter({ hasText: /^SG2\b/ }).first().click();
check('a subject group and a subject band combine',
  (await page.locator('#gfTgTicks label.on').count()) === 1 &&
  (await page.locator('#gfValueTicks label.on').count()) === 1,
  await page.locator('#gfMatchCount').innerText());
await page.locator('#gfClassTicks label', { hasText: '1R1' }).first().click();
check('the live count reflects every tick',
  /\d+ students match this right now/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);

await page.locator('.tabs button[data-tab="memberships"]').click();
const opts = await page.locator('#memGroupSelect option').allInnerTexts();
const mine = opts.find((o) => o.includes('Cheng Xin Ze'));
check('the class was created and auto-filled', !!mine, mine);
check('only the teacher I picked is on it', !!mine && !/Sarah|Priyanka|Kenneth/.test(mine), mine);
await page.selectOption('#memGroupSelect', { label: mine });
const n = parseInt(await page.locator('#memCount').innerText(), 10);
check('only HIST G3 + SG2 + 1R1 students were selected (' + n + ')', n > 0 && n < 26);
// and a member can be edited out afterwards
await page.locator('#memTable tbody tr').first().locator('button[data-act="remove"]').click();
check('a student can be removed by hand afterwards',
  parseInt(await page.locator('#memCount').innerText(), 10) === n - 1);

// renaming a teacher follows them onto the class
await page.locator('.tabs button[data-tab="teachers"]').click();
await page.locator('#teachersTable tbody tr', { hasText: 'Cheng Xin Ze' })
  .locator('button[data-act="edit"]').click();
await page.fill('#teachersTable input[data-edit]', 'Mr Cheng Xin Ze');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);

// classes can be handed to a teacher from their own row, after the fact
await addTeacher('Mdm Rahim');
await page.locator('#teachersTable tbody tr', { hasText: 'Mdm Rahim' })
  .locator('button[data-act="classes"]').click();
await page.waitForSelector('#teacherClassesDialog[open]');
check('a teacher can be given classes from their row',
  (await page.locator('#tcTicks label').count()) > 0);
const allClasses = await page.locator('#tcTicks label').count();
await page.selectOption('#tcSubject', 'English Language');
const englishOnly = await page.locator('#tcTicks label').count();
check('the subject dropdown narrows the list to that subject',
  englishOnly > 0 && englishOnly < allClasses &&
  (await page.locator('#tcTicks').innerText()).indexOf('Mathematics') === -1,
  englishOnly + ' of ' + allClasses);
await page.locator('#tcTicks label').first().click();
check('what they will teach is spelled out before OK',
  (await page.locator('#tcChosenNote').innerText()).startsWith('Teaching 1'),
  await page.locator('#tcChosenNote').innerText());
await page.click('#teacherClassesForm button[type="submit"]');
await page.waitForTimeout(300);
check('the class now lists that teacher too',
  (await page.locator('#teachersTable tbody tr', { hasText: 'Mdm Rahim' }).innerText())
    .indexOf('no classes yet') === -1,
  await page.locator('#teachersTable tbody tr', { hasText: 'Mdm Rahim' }).innerText());
await page.locator('.tabs button[data-tab="groups"]').click();
// several values in ONE column: HIST G3 or HIST G2
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.locator('#gfKeyTicks label').filter({ hasText: /^HIST\b/ }).first().click();
await page.locator('#gfValueTicks label', { hasText: 'HIST G2' }).first().click();
const bothCount = await page.locator('#gfMatchCount').innerText();
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
check('ticking a second group in the same column widens the class', /[1-9]/.test(bothCount), bothCount);

// a subject group is not a form class: SG2 alone must span 1R1-1R6
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await page.locator('#gfTgTicks label').filter({ hasText: /^SG2\b/ }).first().click();
await page.fill('#gfName', 'SG2 only');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'SG2 only');
const sgClasses = new Set((await page.locator('#memTable tbody tr').allInnerTexts())
  .map((t) => t.split('\t')[2]));
check('a subject group cuts across form classes',
  sgClasses.size > 1, Array.from(sgClasses).join(','));

// the level drives what the dialog offers
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await page.evaluate(() => {   // a second level appears in the data
  const m = window.__testModel();
  m.students.push({ id: '4E1-01', name: 'Sec Four Kid', class: '4E1', level: 'Sec 4',
    gender: 'M', pg: '2', tg: 'SG5', origin: 'file', sourceName: 'Sec Four Kid',
    subjects: { POA: 'POA G2' } });
  m.subjectKeys.push('POA');
  window.__loadModelForTest(m);
});
await page.click('#groupCancelBtn');
await page.click('#addGroupBtn');
await page.locator('#gfLevelTicks label').filter({ hasText: /^Sec 4\b/ }).first().click();
check('choosing a level limits the classes to that level',
  (await page.locator('#gfClassTicks').innerText()).includes('4E1') &&
  !(await page.locator('#gfClassTicks').innerText()).includes('1R1'),
  (await page.locator('#gfClassTicks').innerText()).replace(/\s+/g, ' '));
check('and the TG/SG groups', (await page.locator('#gfTgTicks').innerText()).includes('SG5') &&
  !(await page.locator('#gfTgTicks').innerText()).includes('SG1'));
check('and the subject columns on offer',
  (await page.locator('#gfKeyTicks').innerText()).includes('POA') &&
  !(await page.locator('#gfKeyTicks').innerText()).includes('HIST'),
  (await page.locator('#gfKeyTicks').innerText()).replace(/\s+/g, ' '));
check('upper secondary hides PG and form class behind More filters',
  (await page.locator('#gfPgRow').isHidden()) &&
  (await page.locator('#gfClassRow').isHidden()) &&
  !(await page.locator('#gfMoreRow').isHidden()));
await page.click('#gfMoreBtn');
check('but they are one click away when really meant',
  !(await page.locator('#gfPgRow').isHidden()) && !(await page.locator('#gfClassRow').isHidden()));
await page.locator('#gfLevelTicks label').filter({ hasText: /^1\b/ }).first().click();
check('switching back restores the other level',
  (await page.locator('#gfClassTicks').innerText()).includes('1R1') &&
  (await page.locator('#gfKeyTicks').innerText()).includes('HIST'));
check('lower secondary shows the form class outright, PG still behind More',
  !(await page.locator('#gfClassRow').isHidden()) &&
  (await page.locator('#gfPgRow').isHidden()) &&
  !(await page.locator('#gfMoreRow').isHidden()),
  await page.locator('#gfMoreBtn').innerText());

// answering higher up the map clears what hung below it
await page.locator('#gfKeyTicks label').filter({ hasText: /^HIST\b/ }).first().click();
await page.locator('#gfValueTicks label').filter({ hasText: 'HIST G3' }).first().click();
await page.locator('#gfTgTicks label').first().click();
check('a path can be built down the map',
  (await page.locator('#gfValueTicks label.on').count()) === 1 &&
  (await page.locator('#gfTgTicks label.on').count()) === 1);
await page.locator('#gfKeyTicks label').filter({ hasText: /^GEOG\b/ }).first().click();
check('picking a different subject clears the branches under it',
  (await page.locator('#gfValueTicks label.on').count()) === 0 &&
  (await page.locator('#gfTgTicks label.on').count()) === 0);
await page.locator('#gfLevelTicks label').filter({ hasText: 'Every level' }).first().click();
check('and picking a different level clears the subject too',
  (await page.locator('#gfKeyTicks label.on').first().innerText()).startsWith('Any subject'));
await page.click('#groupCancelBtn');

check('renaming a teacher updates their classes',
  (await page.locator('#groupsTable').innerText()).includes('Mr Cheng Xin Ze'));
check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All dialog checks passed');
process.exit(failures.length ? 1 : 0);
