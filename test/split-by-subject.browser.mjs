/* Splitting one allocation into two classes by a second subject.
 * Sec 3 POA is the case: it is timetabled against A Math, so the single
 * "POA G3" allocation is taught as two classes — those who also take A Math
 * and those who do not. */
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

// 24 of 40 take POA; 10 of those also take A Math
await page.evaluate(() => {
  const students = [];
  for (let i = 1; i <= 40; i++) {
    const subj = { EL: 'EL G3' };
    if (i <= 24) subj.POA = 'POA G3';
    if (i <= 10 || (i > 24 && i <= 30)) subj.AMATH = 'AMATH G3';
    students.push({ id: '3E1-' + String(i).padStart(2, '0'), name: 'STUDENT ' + i,
      class: '3E1', level: 'Sec 3', gender: 'M', pg: '3', tg: '', sn: String(i),
      origin: 'file', sourceName: 'STUDENT ' + i, status: '', subjects: subj });
  }
  window.__loadModelForTest({ students, groups: [], memberships: [],
    subjectKeys: ['EL', 'POA', 'AMATH'], sources: [], teachers: [], subjectLabels: [],
    requests: [] });
});

async function buildPoa(which) {
  await page.click('#addGroupBtn');
  await page.waitForSelector('#groupDialog[open]');
  await page.locator('#gfLevelTicks label', { hasText: 'Sec 3' }).first().click();
  await page.locator('#gfKeyTicks label').filter({ hasText: /^POA\b/ }).first().click();
  await page.locator('#gfValueTicks label').filter({ hasText: 'POA G3' }).first().click();
  await page.waitForTimeout(200);
  if (!which) return;
  await page.click('#gfMoreBtn');
  await page.waitForTimeout(200);
  await page.selectOption('#gfAlsoKey', 'AMATH');
  await page.click(which === 'with' ? '#gfAlsoTakes' : '#gfAlsoWithout');
  await page.waitForTimeout(250);
}

await page.locator('.tabs button[data-tab="groups"]').click();

// --- the whole allocation, before splitting it ---
await buildPoa(null);
check('POA G3 on its own is everyone taking it',
  /^24 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
check('the second-subject branch is tucked behind More filters',
  await page.locator('#gfAlsoRow').isHidden());
await page.click('#gfMoreBtn');
await page.waitForTimeout(250);
check('opening More reveals it',
  !(await page.locator('#gfAlsoRow').isHidden()));
check('it offers the level\'s other subject columns, not the one in use',
  (await page.locator('#gfAlsoKey option').allInnerTexts()).join(',') === 'EL,AMATH',
  (await page.locator('#gfAlsoKey option').allInnerTexts()).join(','));
await page.click('#groupCancelBtn');

// --- the half who do not take A Math ---
await buildPoa('without');
check('"does not take" narrows to the rest of them',
  /^14 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
check('and the count says so rather than claiming the opposite',
  (await page.locator('#gfMatchCount').innerText()).includes('does not take AMATH'),
  await page.locator('#gfMatchCount').innerText());
check('the condition shows as a chip that can be taken off again',
  (await page.locator('#gfCriteria .chip').innerText()).includes('does not take AMATH') &&
  (await page.locator('#gfCriteria .chip button').count()) === 1);
check('the suggested name says which half this is',
  (await page.locator('#gfName').inputValue()) === 'Sec 3 POA G3 without AMATH',
  await page.locator('#gfName').inputValue());
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);

// --- and the half who do ---
await buildPoa('with');
check('"also takes" is the other half',
  /^10 students match/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
check('named for its half too',
  (await page.locator('#gfName').inputValue()) === 'Sec 3 POA G3 with AMATH',
  await page.locator('#gfName').inputValue());
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);

const built = await page.evaluate(() => {
  const m = window.__testModel();
  return m.groups.map((g) => ({
    name: g.name,
    rule: g.autoMatch,
    n: m.memberships.filter((x) => x.groupCode === g.code).length,
  }));
});
check('the two classes between them hold every POA student, once each',
  built.length === 2 && built[0].n + built[1].n === 24 &&
  built.every((g) => g.n > 0), JSON.stringify(built.map((g) => g.name + '=' + g.n)));
const overlap = await page.evaluate(() => {
  const m = window.__testModel();
  const seen = {};
  let twice = 0;
  m.memberships.forEach((x) => { if (seen[x.studentId]) twice++; seen[x.studentId] = 1; });
  return twice;
});
check('nobody is in both', overlap === 0);

// --- the rule survives being opened and saved again ---
await page.fill('#groupSearch', 'without');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.waitForSelector('#groupDialog[open]');
await page.waitForTimeout(300);
check('reopening shows the condition rather than dropping it',
  (await page.locator('#gfCriteria').innerText()).includes('does not take AMATH'));
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
check('and saving again leaves it exactly as it was',
  (await page.evaluate(() => window.__testModel().groups
    .filter((g) => /without/i.test(g.name))[0].autoMatch)) === 'POA=POA G3; !AMATH',
  await page.evaluate(() => window.__testModel().groups
    .filter((g) => /without/i.test(g.name))[0].autoMatch));

// --- a new student flows into the right half by themselves ---
await page.evaluate(() => {
  const m = window.__testModel();
  m.students.push({ id: '3E1-99', name: 'LATE ARRIVAL', class: '3E1', level: 'Sec 3',
    gender: 'F', pg: '3', tg: '', sn: '99', origin: 'file', sourceName: 'LATE ARRIVAL',
    status: '', subjects: { POA: 'POA G3' } });
  m.groups.forEach((g) => window.NamelistSchema.autoFillGroup(m, g, ['3E1-99']));
  window.__loadModelForTest(m);
});
const landed = await page.evaluate(() => {
  const m = window.__testModel();
  return m.memberships.filter((x) => x.studentId === '3E1-99')
    .map((x) => m.groups.filter((g) => g.code === x.groupCode)[0].name);
});
check('a new POA student with no A Math joins the "without" class only',
  landed.length === 1 && /without/i.test(landed[0]), landed.join(', '));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All split-by-subject checks passed');
process.exit(failures.length ? 1 : 0);
