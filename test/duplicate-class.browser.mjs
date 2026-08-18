/* Duplicating a class for another subject. One set of students is often
 * taught more than one subject together — the humanities TG takes Geography
 * and History with the same names — so the second class is a copy of the
 * first with the subject swapped, minus anyone the new subject rules out. */
import { chromium } from 'playwright';
import { copyFileSync, mkdtempSync } from 'node:fs';
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

/* A Sec 1 humanities tutorial group: 17 in TG1 taking Geography G2. Of those,
 * 14 also take History G2, two are up at History G3, and one takes no
 * History at all. Two more students take History G2 but are in TG2. */
await page.evaluate(() => {
  const students = [];
  const mk = (i, tg, geog, hist) => students.push({
    id: '1R-' + String(i).padStart(2, '0'), name: 'STUDENT ' + i, class: '1R1',
    level: 'Sec 1', gender: 'F', pg: '2', tg, sn: String(i), origin: 'file',
    sourceName: 'STUDENT ' + i, status: '',
    subjects: Object.assign({ GEOG: geog }, hist ? { HIST: hist } : {}),
  });
  for (let i = 1; i <= 14; i++) mk(i, 'TG1', 'GEOG G2', 'HIST G2');
  mk(15, 'TG1', 'GEOG G2', 'HIST G3');
  mk(16, 'TG1', 'GEOG G2', 'HIST G3');
  mk(17, 'TG1', 'GEOG G2', '');
  mk(18, 'TG2', 'GEOG G2', 'HIST G2');
  mk(19, 'TG2', 'GEOG G2', 'HIST G2');
  window.__loadModelForTest({
    students,
    groups: [{ code: 'G-TG1', name: 'Sec 1 GEOG G2 TG1', subject: 'Geography',
      teachers: ['Mr David Ng'], level: 'Sec 1', autoMatch: 'GEOG=GEOG G2',
      autoPg: '', autoTg: 'TG1', autoClasses: '' }],
    memberships: students.filter((s) => s.tg === 'TG1')
      .map((s) => ({ studentId: s.id, groupCode: 'G-TG1' })),
    subjectKeys: ['GEOG', 'HIST'], sources: [], teachers: ['Mr David Ng'],
    subjectLabels: ['Geography', 'History'], requests: [],
  });
});
await page.locator('.tabs button[data-tab="groups"]').click();
await page.waitForTimeout(200);
check('the source class holds seventeen',
  (await page.locator('#groupsTable tbody tr td:nth-child(6)').first().innerText()) === '17');

await page.locator('#groupsTable tbody tr').first().locator('button[data-act="dup"]').click();
await page.waitForSelector('#dupDialog[open]');
await page.waitForTimeout(300);

check('it offers the columns its own students use, not the one it is built on',
  (await page.locator('#dupKey option').allInnerTexts()).join(',') === 'HIST',
  (await page.locator('#dupKey option').allInnerTexts()).join(','));
check('the allocations are counted over these students, not the whole level',
  (await page.locator('#dupValue option').allInnerTexts()).join(' | ')
    .includes('HIST G2  (14)'),
  (await page.locator('#dupValue option').allInnerTexts()).join(' | '));
check('it starts on "any", which is what keeping the students means',
  (await page.locator('#dupValue').inputValue()) === '');
check('and warns that "any" would lump two bands into one class',
  (await page.locator('#dupNote').innerText()).includes('2 different allocations'),
  await page.locator('#dupNote').innerText());
check('the one taking no History is already left out',
  (await page.locator('#dupNote').innerText()).startsWith('16 of 17 carry over'),
  await page.locator('#dupNote').innerText());
check('and is named, with the reason',
  (await page.locator('#dupList').innerText()).includes('STUDENT 17') &&
  (await page.locator('#dupList').innerText()).includes('does not take HIST'),
  await page.locator('#dupList').innerText().then((t) => t.split('\n').join(' / ')));

await page.selectOption('#dupValue', 'HIST G2');
await page.waitForTimeout(250);
check('pinning the band drops the two who are up at G3',
  (await page.locator('#dupNote').innerText()).startsWith('14 of 17 carry over'),
  await page.locator('#dupNote').innerText());
check('each of the three is listed with why',
  (await page.locator('#dupList tr').count()) === 3 &&
  (await page.locator('#dupList').innerText()).includes('takes HIST G3'),
  (await page.locator('#dupList').innerText()).split('\n').join(' / '));
check('the name is suggested from the level, the new subject and the TG',
  (await page.locator('#dupName').inputValue()) === 'Sec 1 HIST G2 TG1',
  await page.locator('#dupName').inputValue());

await page.click('#dupForm button[type="submit"]');
await page.waitForTimeout(400);

const made = await page.evaluate(() => {
  const m = window.__testModel();
  const g = m.groups.find((x) => x.code !== 'G-TG1');
  return { name: g.name, subject: g.subject, teachers: g.teachers, level: g.level,
    rule: g.autoMatch, tg: g.autoTg,
    members: m.memberships.filter((x) => x.groupCode === g.code).map((x) => x.studentId).sort() };
});
check('the copy keeps the level, the tutorial group and the teacher',
  made.level === 'Sec 1' && made.tg === 'TG1' && made.teachers.join() === 'Mr David Ng',
  JSON.stringify({ level: made.level, tg: made.tg, teachers: made.teachers }));
check('and swaps only the subject in the rule',
  made.rule === 'HIST=HIST G2', made.rule);
check('it is called what the other classes call that column',
  made.subject === 'History', made.subject);
check('exactly the fourteen who fit are on it',
  made.members.length === 14 && !made.members.includes('1R-15') &&
  !made.members.includes('1R-17') && !made.members.includes('1R-18'),
  made.members.length + ' members');
check('the students from another TG are not swept in by the rule',
  !made.members.includes('1R-18') && !made.members.includes('1R-19'));
check('the new class appears in the table', (await page.locator('#groupsTable tbody tr').count()) === 2);

// the copy can itself be duplicated, and the offer runs out when it should
await page.locator('#groupSearch').fill('HIST');
await page.waitForTimeout(200);
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="dup"]').click();
await page.waitForSelector('#dupDialog[open]');
await page.waitForTimeout(200);
check('duplicating the copy offers Geography back',
  (await page.locator('#dupKey option').allInnerTexts()).join(',') === 'GEOG',
  (await page.locator('#dupKey option').allInnerTexts()).join(','));
await page.click('#dupCancelBtn');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
if (process.env.SHOT) {
  await page.locator('#groupSearch').fill('GEOG');
  await page.waitForTimeout(200);
  await page.locator('#groupsTable tbody tr').first().locator('button[data-act="dup"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All duplicate-class checks passed');
process.exit(failures.length ? 1 : 0);
