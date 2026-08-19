/* Two admins with the same folder open. The editor watches namelist.xlsx and
 * merges the other one's saves into the page, field by field, keeping both
 * people's work; only the same field changed by both is held for a decision.
 *
 *   PLAYWRIGHT_CHROMIUM=/path/to/chromium node test/two-admins.browser.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

await page.addInitScript(() => {
  const files = new Map();
  let clock = 1000;
  window.__fs = {
    files,
    put(p, b, lm) { files.set(p, { bytes: new Uint8Array(b), lastModified: lm == null ? ++clock : lm }); },
    get(p) { return files.get(p); },
    list() { return Array.from(files.keys()); },
  };
  const mkFile = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    async getFile() {
      const r = files.get(path);
      return new File([r ? r.bytes : new Uint8Array()], path.split('/').pop(),
        { lastModified: r ? r.lastModified : 0 });
    },
    async createWritable() {
      const chunks = [];
      return {
        async write(d) { chunks.push(d); },
        async close() {
          const buf = await new Blob(chunks).arrayBuffer();
          window.__fs.put(path, new Uint8Array(buf));
        },
      };
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  const mkDir = (prefix, name) => ({
    kind: 'directory', name,
    async getFileHandle(f, o) {
      const p = prefix + f;
      if (!files.has(p) && !(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
      if (!files.has(p)) window.__fs.put(p, new Uint8Array());
      return mkFile(p);
    },
    async getDirectoryHandle(d, o) {
      /* A real one throws when the folder is not there. This used to hand back
       * an empty view of nothing, so "is there a Data folder?" was always yes
       * and the flat-folder branch of the app never ran in a test. */
      const dp = prefix + d + '/';
      let found = false;
      for (const k of files.keys()) { if (k.startsWith(dp)) { found = true; break; } }
      if (!found && !(o && o.create)) {
        const e = new Error('NotFoundError'); e.name = 'NotFoundError'; throw e;
      }
      return mkDir(dp, d);
    },
    async removeEntry(f) { files.delete(prefix + f); },
    async *values() {
      for (const p of Array.from(files.keys())) {
        if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
        yield mkFile(p);
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => mkDir('data/', 'NamelistData');

  /* The other admin: read the file, change it, write it back — exactly what
   * their copy of the editor would do a moment before ours notices. */
  window.__otherAdminSaves = async (mutate) => {
    const rec = files.get('data/namelist.xlsx');
    const wb = XLSX.read(rec.bytes, { type: 'array' });
    const m = window.NamelistSchema.workbookToModel(wb).model;
    mutate(m);
    const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(m), { bookType: 'xlsx', type: 'array' });
    window.__fs.put('data/namelist.xlsx', new Uint8Array(bytes));
  };
  window.__fileModel = () => {
    const rec = files.get('data/namelist.xlsx');
    return window.NamelistSchema.workbookToModel(XLSX.read(rec.bytes, { type: 'array' })).model;
  };
});

await page.goto('file://' + repo + '/dist/admin.html');
await page.evaluate(readFileSync(repo + '/sample/data.js', 'utf8'));
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  const model = { students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [], teachers: [], subjectLabels: [], requests: [] };
  const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(model), { bookType: 'xlsx', type: 'array' });
  window.__fs.put('data/namelist.xlsx', new Uint8Array(bytes), 5000);
});
await page.click('#openFolderBtn');
await page.waitForSelector('#mainScreen:not([hidden])');
check('both admins start from the same file',
  (await page.locator('#countStudents').innerText()) === '156');

/* ---------- 1. different things: both survive, nothing to decide ---------- */

// me: move the first student to another class, from the real dialog
await page.locator('.tabs button[data-tab="students"]').click();
const firstId = await page.locator('#studentsTable tbody tr').first().getAttribute('data-id');
await page.locator('#studentsTable tbody tr').first().locator('button[data-act="edit"]').click();
await page.waitForSelector('#studentDialog[open]');
await page.selectOption('#sfClass', '1R6');
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);

// them: fix a different student's gender, add someone, and tag a teacher
await page.evaluate((id) => window.__otherAdminSaves((m) => {
  const other = m.students.filter((s) => s.id !== id)[3];
  other.gender = other.gender === 'M' ? 'F' : 'M';
  window.__otherEdit = { id: other.id, gender: other.gender };
  m.students.push({ id: 'NEW-01', name: 'THEIR NEW STUDENT', class: '1R1', level: '1',
    gender: 'F', pg: '3', tg: '', sn: '', origin: 'added', sourceName: 'THEIR NEW STUDENT',
    status: '', subjects: {} });
  m.groups[0].teachers = (m.groups[0].teachers || []).concat(['Mr Newcomer']);
}), firstId);
await page.evaluate(() => window.__syncNowForTest());
await page.waitForTimeout(200);

const afterOne = await page.evaluate((id) => {
  const m = window.__testModel();
  const mine = m.students.filter((s) => s.id === id)[0];
  const theirs = m.students.filter((s) => s.id === window.__otherEdit.id)[0];
  return {
    myClass: mine.class,
    theirGender: theirs.gender,
    expectGender: window.__otherEdit.gender,
    theirStudent: m.students.some((s) => s.id === 'NEW-01'),
    teachers: m.groups[0].teachers,
    total: m.students.length,
  };
}, firstId);
check('my edit is still there after their save', afterOne.myClass === '1R6', afterOne.myClass);
check('their edit to another student arrived',
  afterOne.theirGender === afterOne.expectGender);
check('the student they added arrived', afterOne.theirStudent);
check('the teacher they tagged arrived',
  afterOne.teachers.includes('Mr Newcomer'), afterOne.teachers.join(', '));
check('nothing needed a decision', await page.locator('#syncBar').isHidden());
check('and it says what came in',
  !(await page.locator('#mergedNote').isHidden()) &&
  /change/.test(await page.locator('#mergedNote').innerText()),
  await page.locator('#mergedNote').innerText());

/* ---------- 2. the same field: held for a decision ---------- */

await page.evaluate((id) => window.__otherAdminSaves((m) => {
  m.students.filter((s) => s.id === id)[0].class = '1R4';   // the field I just changed
}), firstId);
await page.evaluate(() => window.__syncNowForTest());
await page.waitForTimeout(200);

check('a clash on the same field raises the bar', !(await page.locator('#syncBar').isHidden()),
  await page.locator('#syncText').innerText());
check('my version stays in effect until I decide',
  (await page.evaluate((id) => window.__testModel().students.filter((s) => s.id === id)[0].class,
    firstId)) === '1R6');
check('the editor is not blocked while it waits',
  await page.locator('#addStudentBtn').isEnabled());

await page.click('#syncReviewBtn');
await page.waitForSelector('#conflictDialog[open]');
const clashText = await page.locator('#conflictList').innerText();
check('the review names the student, the field and both values',
  clashText.includes('Class') && clashText.includes('1R6') && clashText.includes('1R4'),
  clashText.replace(/\s+/g, ' ').slice(0, 80));
await page.click('#conflictAllTheirs');
await page.click('#conflictGoBtn');
await page.waitForFunction(() => !document.getElementById('conflictDialog').open);
check('taking theirs applies it',
  (await page.evaluate((id) => window.__testModel().students.filter((s) => s.id === id)[0].class,
    firstId)) === '1R4');
check('and the bar clears', await page.locator('#syncBar').isHidden());

/* ---------- 3. saving writes the merge, not one person's copy ---------- */

await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
const onDisk = await page.evaluate((id) => {
  const m = window.__fileModel();
  return {
    total: m.students.length,
    theirStudent: m.students.some((s) => s.id === 'NEW-01'),
    theirGender: m.students.filter((s) => s.id === window.__otherEdit.id)[0].gender,
    expectGender: window.__otherEdit.gender,
    contested: m.students.filter((s) => s.id === id)[0].class,
    teachers: m.groups[0].teachers,
  };
}, firstId);
check('the saved file has both admins\' work',
  onDisk.theirStudent && onDisk.theirGender === onDisk.expectGender &&
  onDisk.teachers.includes('Mr Newcomer') && onDisk.contested === '1R4',
  JSON.stringify(onDisk));

/* ---------- 4. a save landing mid-edit is merged, not refused ---------- */

await page.locator('.tabs button[data-tab="students"]').click();
await page.locator('#studentsTable tbody tr').nth(1).locator('button[data-act="edit"]').click();
await page.waitForSelector('#studentDialog[open]');
await page.fill('#sfName', 'MY LATEST EDIT');
await page.click('#studentForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('studentDialog').open);
// they save something else in the same moment, and I press Save without syncing first
await page.evaluate(() => window.__otherAdminSaves((m) => {
  m.students.push({ id: 'NEW-02', name: 'LAST MINUTE', class: '1R2', level: '1', gender: 'M',
    pg: '3', tg: '', sn: '', origin: 'added', sourceName: 'LAST MINUTE', status: '', subjects: {} });
}));
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
const bothLanded = await page.evaluate(() => {
  const m = window.__fileModel();
  return m.students.some((s) => s.name === 'MY LATEST EDIT') &&
    m.students.some((s) => s.id === 'NEW-02');
});
check('a save that collides merges instead of overwriting', bothLanded);
check('their version was backed up all the same',
  (await page.evaluate(() => window.__fs.list().filter((p) => p.startsWith('data/backups/')).length)) > 0);

/* ---------- 5. knowing someone else is in ---------- */

await page.evaluate(() => {
  const blob = new TextEncoder().encode(JSON.stringify({ name: 'Mrs Wong', at: Date.now(), tab: 'groups' }));
  window.__fs.put('data/presence/zzz.txt', blob);
  const old = new TextEncoder().encode(JSON.stringify({ name: 'Long Gone', at: Date.now() - 600000 }));
  window.__fs.put('data/presence/old.txt', old);
  // a note from a machine whose clock runs a few minutes fast is not stale
  const fast = new TextEncoder().encode(JSON.stringify({ name: 'Mr Fastclock', at: Date.now() + 240000 }));
  window.__fs.put('data/presence/fast.txt', fast);
  // and one nobody has touched for a day is genuinely abandoned
  const dead = new TextEncoder().encode(JSON.stringify({ name: 'Yesterday', at: Date.now() - 90000000 }));
  window.__fs.put('data/presence/dead.txt', dead);
});
await page.evaluate(() => window.__beatNowForTest());
await page.waitForTimeout(300);
check('the topbar says who else is editing',
  (await page.evaluate(() => window.__presenceForTest().some((p) => p.name === 'Mrs Wong'))) &&
  /editing/.test(await page.locator('#presenceChip').innerText()),
  await page.locator('#presenceChip').innerText());
check('an editor that was closed is not counted',
  !(await page.locator('#presenceChip').innerText()).includes('Long Gone'));
check('but a colleague whose clock runs fast still counts',
  (await page.evaluate(() => window.__presenceForTest().some((p) => p.name === 'Mr Fastclock'))));
check('and their note is not deleted out from under them',
  await page.evaluate(() => window.__fs.list().includes('data/presence/fast.txt')));
check('and this editor announces itself too',
  (await page.evaluate(() => window.__fs.list().filter((p) =>
    p.startsWith('data/presence/') && !/zzz|old|fast|dead/.test(p)).length)) === 1);
check('a note nobody has touched for a day is tidied away',
  (await page.evaluate(() => window.__fs.list().includes('data/presence/dead.txt'))) === false);

check('no JS errors', errors.length === 0, errors.slice(0, 2).join(' | '));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All two-admin checks passed');
process.exit(failures.length ? 1 : 0);
