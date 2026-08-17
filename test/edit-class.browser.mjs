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
await page.fill('#gfName', 'S1 HIST test');
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(300);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1 HIST test');
const start = parseInt(await page.locator('#memCount').innerText(), 10);
check('a class with only a Level takes that whole level (' + start + ')', start === 156);

// now EDIT it and give it a rule — this used to do nothing
await page.locator('.tabs button[data-tab="groups"]').click();
await page.fill('#groupSearch', 'S1 HIST test');
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
check('the dialog lists the current members up front',
  (await page.locator('#gfMemberNote').innerText()).includes('156 of 156 ticked'));
await page.locator('#gfKeyTicks label').filter({ hasText: /^HIST\b/ }).first().click();
await page.locator('#gfValueTicks label', { hasText: 'HIST G3' }).first().click();
check('the live count says how many the rule takes',
  /\d+ students match this right now/.test(await page.locator('#gfMatchCount').innerText()),
  await page.locator('#gfMatchCount').innerText());
await page.click('#groupForm button[type="submit"]');   // accepts the "no longer match" prompt
await page.waitForTimeout(500);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1 HIST test');
const filled = parseInt(await page.locator('#memCount').innerText(), 10);
check('narrowing the rule on edit re-applies it (' + filled + ' of 156)',
  filled > 0 && filled < 156);

// remove two members from inside the Edit dialog
await page.locator('.tabs button[data-tab="groups"]').click();
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
check('the dialog lists the members', (await page.locator('#gfMembers tr').count()) === filled);
await page.locator('#gfMembers input[type=checkbox]').nth(0).uncheck();
await page.locator('#gfMembers input[type=checkbox]').nth(1).uncheck();
check('unticking stages the removals',
  (await page.locator('#gfMemberNote').innerText()).includes('2 will be removed'),
  await page.locator('#gfMemberNote').innerText());
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(400);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1 HIST test');
check('removing from the dialog sticks (' + filled + ' -> ' +
  (await page.locator('#memCount').innerText()) + ')',
  parseInt(await page.locator('#memCount').innerText(), 10) === filled - 2);

// reopening and pressing OK without touching the rule must not re-add them
await page.locator('.tabs button[data-tab="groups"]').click();
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.click('#groupForm button[type="submit"]');
await page.waitForTimeout(300);
await page.locator('.tabs button[data-tab="memberships"]').click();
await page.selectOption('#memGroupSelect', 'S1 HIST test');
check('an unchanged rule does not undo manual removals',
  parseInt(await page.locator('#memCount').innerText(), 10) === filled - 2);
// select-all, both in the dialog and in the Group members candidate list
await page.locator('.tabs button[data-tab="groups"]').click();
await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.click('#gfMembersNone');
check('Untick all clears every member at once',
  (await page.locator('#gfMemberNote').innerText()).includes('0 of'),
  await page.locator('#gfMemberNote').innerText());
await page.click('#gfMembersAll');
check('Tick all puts them back',
  /(\d+) of \1 ticked/.test(await page.locator('#gfMemberNote').innerText()),
  await page.locator('#gfMemberNote').innerText());
await page.click('#groupCancelBtn');

await page.locator('.tabs button[data-tab="memberships"]').click();
await page.waitForTimeout(200);
await page.fill('#memSearch', '1R2');
await page.waitForTimeout(200);
const shown = await page.locator('#memCandidates tbody tr').count();
await page.locator('#memCandCheckAll').check();
check('one box selects every candidate shown (' + shown + ')',
  (await page.locator('#memAddSelBtn').innerText()).includes('(' + shown + ')'),
  await page.locator('#memAddSelBtn').innerText());
await page.locator('#memCandCheckAll').uncheck();
check('and clears them again',
  (await page.locator('#memAddSelBtn').innerText()) === 'Add selected');

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
if (process.env.SHOT) {
  await page.locator('.tabs button[data-tab="groups"]').click();
  await page.locator('#groupsTable tbody tr').first().locator('button[data-act="edit"]').click();
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All edit-class checks passed');
process.exit(failures.length ? 1 : 0);
