/* A class defined by what its students do NOT take above a band.
 * Lower secondary G1 HEMS is the case: every PG 1 student takes it, unless
 * the office gave them a humanities subject at G2 or G3, in which case they
 * sit in that class instead. */
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

/* 24 PG 1 and 16 PG 2. Of the PG 1s: 6 are up in History, 3 up in Geography,
 * one has History written with no band at all (which reads as their PG, G1). */
await page.evaluate(() => {
  const students = [];
  for (let i = 1; i <= 40; i++) {
    const pg = i <= 24 ? '1' : '2';
    const subj = { EL: 'EL G' + pg };
    if (i <= 6) subj.HIST = 'SS/Hist G2';
    else if (i <= 9) subj.GEOG = 'SS/Geog G3';
    else if (i === 10) subj.HIST = 'SS/Hist';        // band left out — reads as G1
    if (i > 24) subj.HIST = 'SS/Hist';               // PG 2, so G2
    students.push({ id: '1R-' + String(i).padStart(2, '0'), name: 'STUDENT ' + i,
      class: '1R1', level: 'Sec 1', gender: 'F', pg, tg: '', sn: String(i),
      origin: 'file', sourceName: 'STUDENT ' + i, status: '', subjects: subj });
  }
  window.__loadModelForTest({ students, groups: [], memberships: [],
    subjectKeys: ['EL', 'HIST', 'GEOG'], sources: [], teachers: [], subjectLabels: [],
    requests: [] });
});

await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await page.waitForSelector('#groupDialog[open]');
await page.locator('#gfLevelTicks label', { hasText: 'Sec 1' }).first().click();
await page.waitForTimeout(250);

check('with no subject chosen the branch is still behind More filters',
  await page.locator('#gfAlsoRow').isHidden());
await page.click('#gfMoreBtn');
await page.waitForTimeout(250);
check('a class need not be built on a subject column to use it',
  !(await page.locator('#gfAlsoRow').isHidden()) &&
  (await page.locator('#gfValueRow').isHidden()),
  'value row hidden: ' + (await page.locator('#gfValueRow').isHidden()));

await page.locator('#gfPgTicks label').filter({ hasText: /^1\b/ }).first().click();
await page.waitForTimeout(250);
check('PG 1 alone is the 24 of them',
  /^24 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());

// --- the cap: no humanities above G1 ---
await page.selectOption('#gfAlsoKey', 'HIST');
await page.selectOption('#gfAlsoBand', 'G1');
await page.click('#gfAlsoCap');
await page.waitForTimeout(250);
check('History above G1 takes six of them out',
  /^18 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
check('the one whose cell leaves the band out is read as G1 and stays',
  await page.evaluate(() => window.__testModel().students
    .find((s) => s.id === '1R-10').subjects.HIST === 'SS/Hist'));

check('the column just used drops off the list',
  !(await page.locator('#gfAlsoKey option').allInnerTexts()).includes('HIST'),
  (await page.locator('#gfAlsoKey option').allInnerTexts()).join(','));
await page.selectOption('#gfAlsoKey', 'GEOG');
await page.click('#gfAlsoCap');
await page.waitForTimeout(250);
check('Geography above G1 takes three more',
  /^15 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
check('both conditions show as chips, each removable',
  (await page.locator('#gfCriteria .chip').count()) === 2 &&
  (await page.locator('#gfCriteria').innerText()).includes('no HIST above G1'),
  await page.locator('#gfCriteria').innerText());
check('the count spells the conditions out rather than leaving a bare number',
  (await page.locator('#gfMatchCount').innerText()).includes('no GEOG above G1'),
  await page.locator('#gfMatchCount').innerText());
check('a class with no subject of its own is still named, not left blank',
  (await page.locator('#gfName').inputValue()) === 'Sec 1 PG1',
  await page.locator('#gfName').inputValue());

await page.fill('#gfName', 'S1 HEMS G1');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(500);

const built = await page.evaluate(() => {
  const m = window.__testModel();
  const g = m.groups[0];
  return { rule: g.autoMatch, pg: g.autoPg, name: g.name,
    members: m.memberships.filter((x) => x.groupCode === g.code).map((x) => x.studentId).sort() };
});
check('the rule is written in a form the workbook can hold',
  built.rule === '!HIST>G1; !GEOG>G1' && built.pg === '1', built.rule + ' / PG ' + built.pg);
check('fifteen students are on the namelist, and the right fifteen',
  built.members.length === 15 && built.members.includes('1R-10') &&
  !built.members.includes('1R-01') && !built.members.includes('1R-07') &&
  !built.members.includes('1R-25'),
  built.members.length + ': ' + built.members.slice(0, 3).join(','));

// --- a new student arriving later is placed by the same rule ---
await page.locator('.tabs button[data-tab="students"]').click();
await page.click('#addStudentBtn');
await page.waitForSelector('#studentDialog[open]');
await page.selectOption('#sfLevel', 'Sec 1');
await page.fill('#sfName', 'LATE ARRIVAL');
await page.selectOption('#sfClass', '1R1');
await page.selectOption('#sfPg', '1');
await page.click('#studentForm button[type="submit"]');
await page.waitForTimeout(500);
check('a PG 1 student added later joins the default class without being asked',
  await page.evaluate(() => {
    const m = window.__testModel();
    const s = m.students.find((x) => x.name === 'LATE ARRIVAL');
    return !!s && m.memberships.some((x) => x.studentId === s.id && x.groupCode === m.groups[0].code);
  }));

await page.click('#addStudentBtn');
await page.waitForSelector('#studentDialog[open]');
await page.selectOption('#sfLevel', 'Sec 1');
await page.fill('#sfName', 'LATE AND UP');
await page.selectOption('#sfClass', '1R1');
await page.selectOption('#sfPg', '1');
await page.locator('#sfSubjects select[data-subj="HIST"]').selectOption('SS/Hist G2');
await page.click('#studentForm button[type="submit"]');
await page.waitForTimeout(500);
check('one arriving with History at G2 is kept out of it',
  await page.evaluate(() => {
    const m = window.__testModel();
    const s = m.students.find((x) => x.name === 'LATE AND UP');
    return !!s && !m.memberships.some((x) => x.studentId === s.id && x.groupCode === m.groups[0].code);
  }));
await page.locator('.tabs button[data-tab="groups"]').click();
await page.waitForTimeout(200);

// --- reopening keeps the conditions ---
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.waitForSelector('#groupDialog[open]');
await page.waitForTimeout(300);
check('reopening shows both conditions rather than dropping them',
  (await page.locator('#gfCriteria .chip').count()) === 2,
  await page.locator('#gfCriteria').innerText());
await page.click('#groupCancelBtn');

// --- an empty name is said out loud, not just bubbled off-screen ---
await page.click('#addGroupBtn');
await page.waitForSelector('#groupDialog[open]');
await page.locator('#gfLevelTicks label', { hasText: 'Sec 1' }).first().click();
await page.fill('#gfName', '');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(300);
check('pressing OK with no name says so instead of doing nothing',
  (await page.locator('#toast').innerText()).includes('needs a name'),
  await page.locator('#toast').innerText());
check('and the dialog stays open', await page.evaluate(() => document.getElementById('groupDialog').open));
await page.click('#groupCancelBtn');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
if (process.env.SHOT) {
  await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All default-class checks passed');
process.exit(failures.length ? 1 : 0);
