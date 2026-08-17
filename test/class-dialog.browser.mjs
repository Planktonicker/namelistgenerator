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
await page.click('#addTeacherBtn');
await page.waitForTimeout(200);
check('a new teacher can be added to the roster',
  (await page.locator('#teachersTable tbody tr').count()) === 18);

// --- class dialog ---
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
check('teachers are PICKED, not typed',
  (await page.locator('#gfTeacher').evaluate((e) => e.tagName)) === 'SELECT');
check('the new teacher is in the picker',
  (await page.locator('#gfTeacher option').allInnerTexts()).includes('Cheng Xin Ze'));
check('there is only ONE level field now',
  (await page.locator('#gfAutoLevel').count()) === 0 && (await page.locator('#gfLevel').count()) === 1);
check('level is a dropdown of levels in the data',
  (await page.locator('#gfLevel').evaluate((e) => e.tagName)) === 'SELECT');
check('PG is a dropdown too', (await page.locator('#gfAutoPg').evaluate((e) => e.tagName)) === 'SELECT');
check('classes are picked from real classes, not typed',
  (await page.locator('#gfAutoClasses').evaluate((e) => e.tagName)) === 'SELECT' &&
  (await page.locator('#gfAutoClasses option').allInnerTexts()).includes('1R1'));
check('TG is offered as a criterion column',
  (await page.locator('#gfAutoKey option').allInnerTexts()).includes('TG'));

// build the class the screenshot was attempting: HIST G3 students in TG2
await page.selectOption('#gfTeacher', 'Cheng Xin Ze');
await page.click('#gfTeacherAdd');
await page.selectOption('#gfAutoKey', 'HIST');
await page.selectOption('#gfAutoValue', 'HIST G3');
await page.click('#gfCritAdd');
await page.selectOption('#gfAutoKey', 'TG');
await page.selectOption('#gfAutoValue', 'TG2');
await page.click('#gfCritAdd');
check('two criteria can be combined',
  (await page.locator('#gfCriteria .chip').count()) === 2,
  (await page.locator('#gfCriteria').innerText()).replace(/\s+/g, ' '));
await page.selectOption('#gfAutoClasses', '1R1');
await page.click('#gfClassAdd');
check('picked class shows as a chip', (await page.locator('#gfClassChips .chip').count()) === 1);
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);

await page.locator('.tabs button[data-tab="memberships"]').click();
const opts = await page.locator('#memGroupSelect option').allInnerTexts();
const mine = opts.find((o) => o.includes('Cheng Xin Ze'));
check('the class was created and auto-filled', !!mine, mine);
check('only the teacher I picked is on it', !!mine && !/Sarah|Priyanka|Kenneth/.test(mine), mine);
await page.selectOption('#memGroupSelect', { label: mine });
const n = parseInt(await page.locator('#memCount').innerText(), 10);
check('only HIST G3 + TG2 + 1R1 students were selected (' + n + ')', n > 0 && n < 26);
// and a member can be edited out afterwards
await page.locator('#memTable tbody tr').first().locator('button[data-act="remove"]').click();
check('a student can be removed by hand afterwards',
  parseInt(await page.locator('#memCount').innerText(), 10) === n - 1);

// renaming a teacher follows them onto the class
await page.locator('.tabs button[data-tab="teachers"]').click();
page.removeAllListeners('dialog');
page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept('Mr Cheng Xin Ze') : d.accept()));
await page.locator('#teachersTable tbody tr', { hasText: 'Cheng Xin Ze' })
  .locator('button[data-act="rename"]').click();
await page.waitForTimeout(300);
await page.locator('.tabs button[data-tab="groups"]').click();
check('renaming a teacher updates their classes',
  (await page.locator('#groupsTable').innerText()).includes('Mr Cheng Xin Ze'));
check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All dialog checks passed');
process.exit(failures.length ? 1 : 0);
