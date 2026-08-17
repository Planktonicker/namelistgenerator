/* Editing a class's rule must apply it, and members must be adjustable there. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  window.__loadModelForTest({ students: d.students, groups: [], memberships: [],
    subjectKeys: d.subjectKeys, sources: [], teachers: [] }); });

// create a class with NO criteria yet — the situation that produced 0 members
await page.locator('.tabs button[data-tab="groups"]').click();
await page.click('#addGroupBtn');
await page.click('#gfTeacherNew');
await page.fill('#gfCode', 'S1-HIST-TEST');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(300);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1-HIST-TEST');
const start = parseInt(await page.locator('#memCount').innerText(), 10);
check('a class with only a Level takes that whole level (' + start + ')', start === 156);

// now EDIT it and give it a rule — this used to do nothing
await page.locator('.tabs button[data-tab="groups"]').click();
await page.fill('#groupSearch', 'S1-HIST-TEST');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
check('the dialog lists the current members up front',
  (await page.locator('#gfMemberNote').innerText()).includes('156 students in this class'));
await page.selectOption('#gfAutoKey', 'HIST');
await page.selectOption('#gfAutoValue', 'HIST G3');
await page.click('#gfCritAdd');
await page.click('#groupForm button[type="submit"]');   // accepts the "no longer match" prompt
await page.waitForTimeout(500);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1-HIST-TEST');
const filled = parseInt(await page.locator('#memCount').innerText(), 10);
check('narrowing the rule on edit re-applies it (' + filled + ' of 156)',
  filled > 0 && filled < 156);

// remove two members from inside the Edit dialog
await page.locator('.tabs button[data-tab="groups"]').click();
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
check('the dialog lists the members', (await page.locator('#gfMembers tr').count()) === filled);
await page.locator('#gfMembers button').first().click();
await page.locator('#gfMembers button').first().click();
check('removals are staged and counted',
  (await page.locator('#gfMemberNote').innerText()).includes('2 to be removed'));
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1-HIST-TEST');
check('removing from the dialog sticks (' + filled + ' -> ' +
  (await page.locator('#memCount').innerText()) + ')',
  parseInt(await page.locator('#memCount').innerText(), 10) === filled - 2);

// reopening and pressing OK without touching the rule must not re-add them
await page.locator('.tabs button[data-tab="groups"]').click();
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(300);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1-HIST-TEST');
check('an unchanged rule does not undo manual removals',
  parseInt(await page.locator('#memCount').innerText(), 10) === filled - 2);
check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
if (process.env.SHOT) {
  await page.locator('.tabs button[data-tab="groups"]').click();
  await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All edit-class checks passed');
process.exit(failures.length ? 1 : 0);
