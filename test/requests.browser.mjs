/* The full loop: a teacher suggests a change on namelist.html, hands the
 * message over, and the admin accepts or turns it down in admin.html. */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));
copyFileSync(join(repo, 'dist/namelist.html'), join(demo, 'namelist.html'));
copyFileSync(join(repo, 'sample/data.js'), join(demo, 'data.js'));

const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });

/* ---------------- teacher side ---------------- */
const t = await ctx.newPage();
const tErr = [];
t.on('pageerror', (e) => tErr.push(String(e)));
let asked = '';
t.on('dialog', (d) => {
  asked = d.message();
  if (d.type() === 'prompt') d.accept('shared class — the other half is not mine');
  else d.accept();
});
await t.goto('file://' + demo + '/namelist.html');
await t.evaluate(() => localStorage.clear());
await t.reload();

const teacher = await t.locator('#teacherSelect option').nth(1).getAttribute('value');
await t.selectOption('#teacherSelect', teacher);
await t.waitForSelector('#teacherResults .card');

check('a teacher page starts with no suggestion tray', await t.locator('#trayCard').isHidden());

// turn on suggest mode for the first class
await t.locator('#teacherResults button[data-suggest]').first().click();
await t.waitForSelector('#teacherResults .namelist th.no-print');
const firstName = await t.locator('#teacherResults .namelist tbody tr').first()
  .locator('.nl-name').innerText();
check('suggest mode adds a column that never prints',
  (await t.locator('#teacherResults .namelist th.no-print').first().innerText()) === 'Suggest');

// suggest removing the first student
await t.locator('#teacherResults button[data-drop]').first().click();
await t.waitForSelector('#trayCard:not([hidden])');
check('removing asks why', /come off this namelist/.test(asked), asked.split('\n')[0]);
check('the tray says one suggestion is ready',
  (await t.locator('#trayTitle').innerText()) === '1 suggestion ready to send',
  await t.locator('#trayTitle').innerText());
check('the struck-through row shows which one',
  (await t.locator('#teacherResults .namelist tr.dropping .nl-name').innerText()) === firstName);

// and suggest adding someone
const groupCode = await t.locator('#teacherResults input[data-add]').first().getAttribute('data-add');
await t.fill('#teacherResults input[data-add="' + groupCode + '"]', 'jason lim');
check('the name box forces capitals',
  (await t.locator('#teacherResults input[data-add="' + groupCode + '"]').inputValue()) === 'JASON LIM');
await t.fill('#teacherResults input[data-why="' + groupCode + '"]', 'joined last week');
await t.locator('#teacherResults button[data-addbtn]').first().click();
await t.waitForFunction(() => document.getElementById('trayTitle').textContent.startsWith('2'));
check('both suggestions are in the tray', true);
check('nothing on the page actually changed',
  (await t.locator('#teacherResults .namelist tbody tr').count()) > 0 &&
  !(await t.locator('#teacherResults').innerText()).includes('JASON LIM'));

// review and send
await t.click('#traySendBtn');
await t.waitForSelector('#sendDialog[open]');
const message = await t.locator('#sendText').inputValue();
check('the message is readable before the machine part',
  message.includes('NAMELIST REQUEST') && message.includes('ADD     JASON LIM') &&
  message.includes('REMOVE  ' + firstName) && message.indexOf('NLREQ1') > message.indexOf('ADD'),
  message.split('\n').slice(4, 6).join(' / '));
await t.click('#sendDoneBtn');
await t.waitForFunction(() => !document.getElementById('sendDialog').open);
check('after sending, the tray says it is with the admin',
  (await t.locator('#trayBody').innerText()).includes('sent, waiting'));

/* ---------------- admin side ---------------- */
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let adminAsked = [];
page.on('dialog', (d) => {
  adminAsked.push(d.message());
  if (d.type() === 'prompt') d.accept('already covered by the other teacher');
  else d.accept();
});
await page.goto('file://' + demo + '/admin.html');
await page.evaluate(readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  window.__loadModelForTest({ students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], requests: [] });
});

await page.locator('.tabs button[data-tab="requests"]').click();
check('the Requests tab starts empty',
  !(await page.locator('#requestsEmpty').isHidden()));

await page.click('#reqPasteBtn');
await page.waitForSelector('#pasteRequestDialog[open]');
await page.fill('#pasteRequestText', 'nonsense that is not a request');
await page.click('#pasteRequestGoBtn');
check('rubbish is refused with a reason',
  (await page.locator('#pasteRequestNote').innerText()).includes('NLREQ1'),
  await page.locator('#pasteRequestNote').innerText());

// paste it the way it survives an email: quoted and hard-wrapped
await page.fill('#pasteRequestText', message.split('\n').map((l) => '> ' + l).join('\r\n'));
await page.click('#pasteRequestGoBtn');
await page.waitForFunction(() => !document.getElementById('pasteRequestDialog').open);
check('a quoted email paste is read anyway',
  (await page.locator('#requestsList .req').count()) === 2,
  await page.locator('#countRequests').innerText());
check('the tab badge counts what is waiting',
  (await page.locator('#countRequests').innerText()) === '2');
check('each card names the teacher, the class and the reason',
  (await page.locator('#requestsList').innerText()).includes(teacher) &&
  (await page.locator('#requestsList').innerText()).includes('joined last week'));

// pasting the same message twice must not duplicate anything
await page.click('#reqPasteBtn');
await page.fill('#pasteRequestText', message);
await page.click('#pasteRequestGoBtn');
await page.waitForFunction(() => !document.getElementById('pasteRequestDialog').open);
check('sending the same list twice does not double it',
  (await page.locator('#requestsList .req').count()) === 2);

// --- accept the "add", correcting the spelling on the way through
const addCard = page.locator('#requestsList .req').filter({ hasText: 'JASON LIM' });
await addCard.locator('button[data-new]').click();
await page.waitForSelector('#studentDialog[open]');
check('approving an add opens the student form with their name in it',
  (await page.locator('#sfName').inputValue()) === 'JASON LIM');
check('and with no ID field — the app allocates it',
  (await page.locator('#sfIdNote').innerText()).includes('will be given automatically'));
const subjPrefilled = await page.locator('#sfSubjects select').evaluateAll(
  (sels) => sels.filter((s) => s.value).map((s) => s.dataset.subj + '=' + s.value));
check('the class\'s own subject is already set',
  subjPrefilled.length >= 1, subjPrefilled.join(', '));
await page.fill('#sfName', 'JASON LIM WEI HENG');
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
check('the corrected spelling is what gets created',
  (await page.evaluate(() => window.__testModel().students.filter(
    (s) => s.name === 'JASON LIM WEI HENG').length)) === 1);
const inClass = await page.evaluate((code) => {
  const m = window.__testModel();
  const s = m.students.filter((e) => e.name === 'JASON LIM WEI HENG')[0];
  return m.memberships.some((x) => x.studentId === s.id && x.groupCode === code);
}, groupCode);
check('and they join the class the teacher asked for', inClass);
check('the request is settled, so it leaves the waiting list',
  (await page.locator('#countRequests').innerText()) === '1');

// --- turn down the "remove"
const remCard = page.locator('#requestsList .req').first();
adminAsked = [];
await remCard.locator('button[data-rej]').click();
await page.waitForTimeout(200);
check('turning one down asks for a reason', /Turn down this suggestion/.test(adminAsked[0] || ''),
  (adminAsked[0] || '').split('\n')[0]);
check('nothing is waiting now', (await page.locator('#countRequests').innerText()) === '0');
await page.selectOption('#reqFilter', 'all');
check('settled ones are still readable, with what was decided',
  (await page.locator('#requestsList .req.settled').count()) === 2 &&
  (await page.locator('#requestsList').innerText()).includes('already covered by the other teacher'));

// keep the two decided requests: the teacher must be able to see what happened
const settled = await page.evaluate(() => window.__testModel().requests);

/* --- the short-form case: the teacher wrote part of a name we already hold --- */
await page.evaluate(() => {
  const m = window.__testModel();
  const g = m.groups[0];
  // a full name of the kind the office writes, that nobody has put in this class
  const full = 'TAN WEI MING NATHAN';
  m.students.push({ id: 'X-99', name: full, class: '1R1', level: '1', gender: 'M', pg: '3',
    tg: '', sn: '', origin: 'file', sourceName: full, status: '', subjects: {} });
  m.requests = [{ id: 'rShort', made: '2026-08-17T02:00:00Z', teacher: 'Mr Tan', group: g.code,
    action: 'add', name: 'WEI MING', studentId: '', reason: 'he is in my class', status: 'open',
    decided: '', note: '' }];
  window.__shortCase = { sid: 'X-99', full, short: 'WEI MING', code: g.code };
  window.__loadModelForTest(m);
});
await page.locator('.tabs button[data-tab="requests"]').click();
await page.selectOption('#reqFilter', 'open');
const shortCase = await page.evaluate(() => window.__shortCase);
const candText = await page.locator('#requestsList .req-match').innerText();
check('a short form offers the student we already hold',
  candText.includes(shortCase.full), candText.replace(/\s+/g, ' ').slice(0, 90));
await page.locator('#requestsList .req-cand button').first().click();
await page.waitForTimeout(200);
check('picking them adds that existing student, creating nobody new',
  await page.evaluate(() => {
    const c = window.__shortCase;
    const m = window.__testModel();
    return m.memberships.some((x) => x.studentId === c.sid && x.groupCode === c.code) &&
      !m.students.some((s) => s.name === c.short);
  }));
check('and the request is settled', (await page.locator('#countRequests').innerText()) === '0');

// a surname everyone shares is not a lead, and must not be offered
await page.evaluate(() => {
  const m = window.__testModel();
  const surname = m.students[0].name.split(' ').pop().toUpperCase();
  m.requests = [{ id: 'rSur', made: '2026-08-17T02:00:00Z', teacher: 'Mr Tan',
    group: m.groups[0].code, action: 'add', name: 'BRAND NEWCHILD ' + surname, studentId: '',
    reason: '', status: 'open', decided: '', note: '' }];
  window.__loadModelForTest(m);
});
await page.locator('.tabs button[data-tab="requests"]').click();
check('sharing only a surname is not offered as a match',
  (await page.locator('#requestsList .req-match').count()) === 0);
await page.evaluate(() => {
  const m = window.__testModel();
  m.requests = [];
  window.__loadModelForTest(m);
});

/* --- the other two ways of dealing with a removal --- */
await page.evaluate(() => {
  const m = window.__testModel();
  const g = m.groups[0];
  const member = m.memberships.filter((x) => x.groupCode === g.code)[0];
  const s = m.students.filter((e) => e.id === member.studentId)[0];
  window.__loadModelForTest(Object.assign(m, { requests: [
    { id: 'rOff', made: '2026-08-17T02:00:00Z', teacher: 'Mr Tan', group: g.code, action: 'remove',
      name: s.name, studentId: s.id, reason: 'not my half', status: 'open', decided: '', note: '' },
  ] }));
  window.__reqFixture = { sid: s.id, code: g.code, name: s.name };
});
await page.locator('.tabs button[data-tab="requests"]').click();
await page.selectOption('#reqFilter', 'open');
await page.locator('#requestsList .req button[data-off]').click();
await page.waitForTimeout(200);
const offOk = await page.evaluate(() => {
  const f = window.__reqFixture;
  const m = window.__testModel();
  return {
    gone: !m.memberships.some((x) => x.studentId === f.sid && x.groupCode === f.code),
    stillOnRoll: m.students.some((s) => s.id === f.sid && !s.status),
  };
});
check('"take off this class" removes only that membership', offOk.gone && offOk.stillOnRoll,
  JSON.stringify(offOk));

// mark as left: the school file still lists them, so they are held out instead
await page.evaluate(() => {
  const f = window.__reqFixture;
  const m = window.__testModel();
  m.requests = [{ id: 'rLeft', made: '2026-08-17T02:00:00Z', teacher: 'Mr Tan', group: f.code,
    action: 'remove', name: f.name, studentId: f.sid, reason: 'left the school', status: 'open',
    decided: '', note: '' }];
  window.__loadModelForTest(m);
});
await page.locator('.tabs button[data-tab="requests"]').click();
adminAsked = [];
await page.locator('#requestsList .req button[data-left]').click();
await page.waitForTimeout(200);
check('a student from the school file is marked as left, not deleted',
  /marked as having left|Mark .* as having left the school/i.test(adminAsked[0] || ''),
  (adminAsked[0] || '').split('\n')[0]);
const leftState = await page.evaluate(() => {
  const f = window.__reqFixture;
  const m = window.__testModel();
  const s = m.students.filter((e) => e.id === f.sid)[0];
  return { status: s && s.status, memberships: m.memberships.filter((x) => x.studentId === f.sid).length };
});
check('they stay on the roll marked "left", in no class at all',
  leftState.status === 'left' && leftState.memberships === 0, JSON.stringify(leftState));

// a level refresh must not quietly bring them back
const survives = await page.evaluate(() => {
  const f = window.__reqFixture;
  const m = window.__testModel();
  const s = m.students.filter((e) => e.id === f.sid)[0];
  window.NamelistSchema.applyLevelUpdate(m, [{
    name: s.name, class: s.class, level: s.level, gender: s.gender, pg: s.pg, tg: s.tg,
    sn: s.sn, subjects: s.subjects,
  }], Object.keys(s.subjects || {}));
  m.groups.forEach((g) => window.NamelistSchema.autoFillGroup(m, g));
  const after = m.students.filter((e) => e.id === f.sid)[0];
  return { status: after.status, inClasses: m.memberships.filter((x) => x.studentId === f.sid).length };
});
check('and a refresh from the school file keeps them out',
  survives.status === 'left' && survives.inClasses === 0, JSON.stringify(survives));

// the admin can put them back
await page.locator('.tabs button[data-tab="students"]').click();
await page.selectOption('#studentOriginFilter', 'left');
check('the Students tab can list who has left',
  (await page.locator('#studentsTable tbody tr').count()) === 1 &&
  (await page.locator('#studentsTable tbody').innerText()).includes('left'));
await page.locator('#studentsTable button[data-act="back"]').click();
await page.waitForTimeout(200);
check('Back on roll undoes it',
  (await page.evaluate(() => {
    const f = window.__reqFixture;
    const m = window.__testModel();
    return !m.students.filter((e) => e.id === f.sid)[0].status;
  })));

/* ---------------- teacher sees the outcome ---------------- */
const dataJs = await page.evaluate((reqs) => {
  const m = window.__testModel();
  m.requests = reqs;
  return window.NamelistSchema.modelToDataJs(m, new Date().toISOString());
}, settled);
writeFileSync(join(demo, 'data.js'), dataJs);

await t.reload();
await t.selectOption('#teacherSelect', teacher);
await t.waitForSelector('#trayCard:not([hidden])');
const trayText = await t.locator('#trayBody').innerText();
check('the teacher is told which suggestion was accepted',
  /JASON LIM.*accepted/s.test(trayText), trayText.split('\n')[0]);
check('and which was not, with the admin\'s reason',
  /not taken up/.test(trayText) && trayText.includes('already covered by the other teacher'),
  trayText.split('\n')[1]);
await t.click('#trayClearBtn');
await t.waitForTimeout(200);
check('and can clear them away', await t.locator('#trayCard').isHidden());

check('admin page: no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
check('teacher page: no JS errors', tErr.length === 0, tErr.slice(0, 2).join(' | '));

if (process.env.SHOT) {
  await page.locator('.tabs button[data-tab="requests"]').click();
  await page.selectOption('#reqFilter', 'all');
  await page.screenshot({ path: process.env.SHOT });
}
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All request checks passed');
process.exit(failures.length ? 1 : 0);
