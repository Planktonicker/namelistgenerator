/* Adding a student: two answers the form can work out from ones already
 * given. Lower secondary is banded by form class, so the class says which
 * tutorial group; and the posting group says which band of English, Maths,
 * Science and the humanities they are on. Both are defaults — the admin's own
 * choice always wins, and everything stays editable. */
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
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept('1R7'));
await page.goto('file://' + demo + '/admin.html');

/* Sec 1 and Sec 2 band by form class: 1-3 are TG1, 4-6 are TG2. Sec 3 does
 * not — there the subject group belongs to the combination, and one form
 * class holds several. Mother tongue splits by language at every level. */
await page.evaluate(() => {
  const students = [];
  const MT = ['CL', 'ML', 'TL'];
  let n = 0;
  const add = (level, cls, tg, pg, extra) => {
    n++;
    students.push({ id: cls + '-' + String(n).padStart(3, '0'), name: 'STUDENT ' + n,
      class: cls, level, gender: n % 2 ? 'F' : 'M', pg: String(pg), tg, sn: String(n),
      origin: 'file', sourceName: 'STUDENT ' + n, status: '',
      subjects: Object.assign({
        EL: 'EL G' + pg, MT: MT[n % 3] + ' G' + pg, MA: 'MA G' + pg,
        SCI: 'Sci PC G' + pg, HIST: 'SS/Hist G' + pg, GEOG: 'SS/Geog G' + pg,
      }, extra || {}) });
  };
  for (let c = 1; c <= 6; c++) {
    for (let i = 0; i < 10; i++) {
      add('Sec 1', '1R' + c, c <= 3 ? 'TG1' : 'TG2', (i % 3) + 1);
      add('Sec 2', '2I' + c, c <= 3 ? 'TG1' : 'TG2', (i % 3) + 1);
    }
  }
  // Sec 3: one form class, several subject groups — nothing to read off it
  for (let i = 0; i < 24; i++) {
    add('Sec 3', '3E1', 'SG' + ((i % 6) + 1), (i % 3) + 1, { POA: 'POA G3' });
  }
  // one HMT student, so the column exists but is nobody's default
  students[0].subjects.HMT = 'CHINESE';
  window.__loadModelForTest({ students, groups: [], memberships: [],
    subjectKeys: ['EL', 'MT', 'HMT', 'MA', 'SCI', 'HIST', 'GEOG', 'POA'],
    sources: [], teachers: [], subjectLabels: [], requests: [] });
});

const open = async (level) => {
  await page.click('#addStudentBtn');
  await page.waitForSelector('#studentDialog[open]');
  await page.selectOption('#sfLevel', level);
  await page.waitForTimeout(150);
};
const subj = async (key) =>
  page.locator('#sfSubjects select[data-subj="' + key + '"]').inputValue();

// --- the class says which tutorial group ---
await open('Sec 1');
await page.selectOption('#sfClass', '1R1');
await page.waitForTimeout(150);
check('Sec 1, class 1R1 fills in TG1 by itself',
  (await page.locator('#sfTg').inputValue()) === 'TG1',
  await page.locator('#sfTg').inputValue());
await page.selectOption('#sfClass', '1R5');
await page.waitForTimeout(150);
check('and moving to 1R5 follows it to TG2',
  (await page.locator('#sfTg').inputValue()) === 'TG2',
  await page.locator('#sfTg').inputValue());
await page.selectOption('#sfTg', 'TG1');
await page.selectOption('#sfClass', '1R6');
await page.waitForTimeout(150);
check('but a TG the admin picked is not overwritten',
  (await page.locator('#sfTg').inputValue()) === 'TG1',
  await page.locator('#sfTg').inputValue());
await page.click('#studentCancelBtn');

await open('Sec 2');
await page.selectOption('#sfClass', '2I2');
await page.waitForTimeout(150);
check('Sec 2 works the same way — 2I2 is TG1',
  (await page.locator('#sfTg').inputValue()) === 'TG1',
  await page.locator('#sfTg').inputValue());
await page.selectOption('#sfClass', '2I4');
await page.waitForTimeout(150);
check('and 2I4 is TG2', (await page.locator('#sfTg').inputValue()) === 'TG2',
  await page.locator('#sfTg').inputValue());
await page.click('#studentCancelBtn');

await open('Sec 3');
await page.selectOption('#sfClass', '3E1');
await page.waitForTimeout(150);
check('upper secondary is left alone — one form class holds several groups',
  (await page.locator('#sfTg').inputValue()) === '',
  await page.locator('#sfTg').inputValue());
await page.click('#studentCancelBtn');

// --- the posting group says which band ---
await open('Sec 1');
await page.selectOption('#sfPg', '2');
await page.waitForTimeout(200);
check('PG 2 fills English, Maths, Science and the humanities at G2',
  (await subj('EL')) === 'EL G2' && (await subj('MA')) === 'MA G2' &&
  (await subj('SCI')) === 'Sci PC G2' && (await subj('HIST')) === 'SS/Hist G2' &&
  (await subj('GEOG')) === 'SS/Geog G2',
  [await subj('EL'), await subj('MA'), await subj('SCI'), await subj('HIST'),
    await subj('GEOG')].join(', '));
check('in the school\'s own spelling, not one built out of the column name',
  (await subj('SCI')) === 'Sci PC G2' && (await subj('HIST')) === 'SS/Hist G2');
check('mother tongue is left alone — the PG says nothing about which language',
  (await subj('MT')) === '', await subj('MT'));
check('nor is a subject only one student takes filled in',
  (await subj('HMT')) === '', await subj('HMT'));

await page.selectOption('#sfPg', '3');
await page.waitForTimeout(200);
check('changing the PG moves them all to the new band',
  (await subj('EL')) === 'EL G3' && (await subj('HIST')) === 'SS/Hist G3',
  [await subj('EL'), await subj('HIST')].join(', '));

await page.locator('#sfSubjects select[data-subj="HIST"]').selectOption('SS/Hist G1');
await page.selectOption('#sfPg', '1');
await page.waitForTimeout(200);
check('a subject the admin set by hand survives the next PG change',
  (await subj('HIST')) === 'SS/Hist G1' && (await subj('EL')) === 'EL G1',
  [await subj('HIST'), await subj('EL')].join(', '));

// --- and the whole thing saves ---
await page.fill('#sfName', 'NEW ARRIVAL');
await page.selectOption('#sfClass', '1R2');
await page.waitForTimeout(150);
await page.click('#studentForm button[type="submit"]');
await page.waitForTimeout(400);
const saved = await page.evaluate(() =>
  window.__testModel().students.find((s) => s.name === 'NEW ARRIVAL'));
check('the defaults are what gets saved, alongside the hand-picked one',
  saved && saved.tg === 'TG1' && saved.pg === '1' && saved.subjects.EL === 'EL G1' &&
  saved.subjects.HIST === 'SS/Hist G1' && !saved.subjects.MT,
  saved ? JSON.stringify({ tg: saved.tg, pg: saved.pg, s: saved.subjects }) : 'not saved');

// --- editing somebody is never rewritten under them ---
await page.locator('.tabs button[data-tab="students"]').click();
await page.fill('#studentSearch', 'STUDENT 4');
await page.waitForTimeout(250);
await page.locator('#studentsTable tbody tr').first().locator('button[data-act="open"]').click();
await page.waitForSelector('#studentDialog[open]');
await page.waitForTimeout(200);
const theirs = { el: await subj('EL'), hist: await subj('HIST'), mt: await subj('MT') };
await page.selectOption('#sfPg', String((parseInt(await page.locator('#sfPg').inputValue(), 10) % 3) + 1));
await page.waitForTimeout(250);
check('changing an existing student\'s PG does not rewrite their subjects',
  (await subj('EL')) === theirs.el && (await subj('HIST')) === theirs.hist &&
  (await subj('MT')) === theirs.mt,
  'was ' + JSON.stringify(theirs) + ', now ' +
  JSON.stringify({ el: await subj('EL'), hist: await subj('HIST'), mt: await subj('MT') }));
await page.click('#studentCancelBtn');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All student-defaults checks passed');
process.exit(failures.length ? 1 : 0);
