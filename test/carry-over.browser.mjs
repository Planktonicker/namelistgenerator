/* A folder with the pages but no data: the app should offer to carry the data
 * over from another folder's namelist.xlsx, or rebuild from a data.js left
 * behind, and then write both files here on the first Save. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs';
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
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

// An empty data folder, in memory — the same fake as the conflict test.
await page.addInitScript(() => {
  const files = new Map();
  window.__fs = {
    put(p, b, lm) { files.set(p, { bytes: new Uint8Array(b), lastModified: lm }); },
    get(p) { return files.get(p); },
    list() { return Array.from(files.keys()); },
  };
  const mkFile = (path) => ({
    kind: 'file', name: path.split('/').pop(),
    async getFile() {
      const r = files.get(path);
      const f = new File([r ? r.bytes : new Uint8Array()], path.split('/').pop(),
        { lastModified: r ? r.lastModified : 0 });
      return f;
    },
    async createWritable() {
      const chunks = [];
      return {
        async write(d) { chunks.push(d); },
        async close() {
          const buf = await new Blob(chunks).arrayBuffer();
          files.set(path, { bytes: new Uint8Array(buf), lastModified: 1 });
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
      if (!files.has(p)) window.__fs.put(p, new Uint8Array(), 0);
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
    async *values() {
      for (const p of files.keys()) {
        if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
        yield mkFile(p);
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => mkDir('new/', 'Namelist 2027');
});

await page.goto('file://' + demo + '/admin.html');

// --- an empty folder offers to carry data over ---
await page.click('#openFolderBtn');
await page.waitForSelector('#setupScreen:not([hidden])');
check('an empty folder says what it will create',
  (await page.locator('#setupScreen').innerText()).includes('creates namelist.xlsx'));
check('and offers to carry on from another folder',
  !(await page.locator('#setupCarryOn').isHidden()) &&
  (await page.locator('#setupCarryOnText').innerText()).includes('Carrying on from another folder'));
check('with no data.js here, there is nothing to rebuild from',
  await page.locator('#setupRecoverBtn').isHidden());

// --- adopt the old folder's namelist.xlsx ---
const old = readFileSync(join(repo, 'sample/namelist.xlsx'));
await page.setInputFiles('#setupAdoptInput', {
  name: 'namelist.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: old,
});
await page.waitForSelector('#mainScreen:not([hidden])');
const carried = await page.locator('#countStudents').innerText();
check('the old folder\'s data is carried over (' + carried + ')', +carried === 156);
check('and it is unsaved, because this folder has nothing yet',
  (await page.locator('#dirtyNote').innerText()).includes('Unsaved'));
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
check('Save writes both files into THIS folder', await page.evaluate(() =>
  !!window.__fs.get('new/namelist.xlsx') && !!window.__fs.get('new/data.js')));

// --- a folder with only a data.js can be rebuilt from it ---
const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page2.on('pageerror', (e) => errors.push('rebuild: ' + String(e)));
page2.on('dialog', (d) => d.accept());
await page2.addInitScript((js) => {
  const files = new Map();
  files.set('half/data.js', { bytes: new TextEncoder().encode(js), lastModified: 5 });
  window.__fs = {
    get: (p) => files.get(p),
    list: () => Array.from(files.keys()),
    put: (p, bytes, lm) => files.set(p, { bytes: new Uint8Array(bytes), lastModified: lm || 1 }),
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
          files.set(path, { bytes: new Uint8Array(buf), lastModified: 1 });
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
      if (!files.has(p)) files.set(p, { bytes: new Uint8Array(), lastModified: 0 });
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
    async *values() {
      for (const p of files.keys()) {
        if (!p.startsWith(prefix) || p.slice(prefix.length).includes('/')) continue;
        yield mkFile(p);
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  });
  window.showDirectoryPicker = async () => mkDir('half/', 'Namelist copy');
}, readFileSync(join(repo, 'sample/data.js'), 'utf8'));
await page2.goto('file://' + demo + '/admin.html');
await page2.click('#openFolderBtn');
await page2.waitForSelector('#setupScreen:not([hidden])');
check('a folder holding only a data.js says so',
  !(await page2.locator('#setupRecoverBtn').isHidden()) &&
  (await page2.locator('#setupCarryOnText').innerText()).includes('data.js from a previous save'));
await page2.click('#setupRecoverBtn');
await page2.waitForSelector('#mainScreen:not([hidden])');
check('rebuilding from data.js brings the students and classes back',
  (await page2.locator('#countStudents').innerText()) === '156' &&
  (await page2.locator('#countGroups').innerText()) === '16',
  await page2.locator('#countStudents').innerText());
check('and warns that the school-file settings did not survive',
  (await page2.locator('#warningsList').innerText()).includes('point each level'));
await page2.click('#saveBtn');
await page2.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
check('Save then writes the workbook it was missing',
  await page2.evaluate(() => !!window.__fs.get('half/namelist.xlsx')));

/* Two admins setting up the same folder on the same morning. The first
 * save used to create namelist.xlsx over whatever was there, with no merge
 * and no backup, because the merge path only ran once a file handle existed. */
await page2.evaluate(() => {
  const m = window.__testModel();
  // the other admin got there first and saved a student we do not have
  const theirs = { students: m.students.slice(0, 3).concat([{ id: 'THEIRS-01',
    name: 'THE OTHER ADMINS STUDENT', class: '1R1', level: '1', gender: 'F', pg: '3', tg: '',
    sn: '', origin: 'added', sourceName: 'THE OTHER ADMINS STUDENT', status: '', subjects: {} }]),
    groups: [], memberships: [], subjectKeys: m.subjectKeys, sources: [], teachers: [],
    subjectLabels: [], requests: [] };
  const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(theirs),
    { bookType: 'xlsx', type: 'array' });
  window.__fs.put('half/namelist.xlsx', new Uint8Array(bytes), Date.now());
  // and this page has not saved into this folder yet
  window.__resetFileHandleForTest();
});
await page2.click('#addStudentBtn');
await page2.fill('#sfName', 'My Own Student');
await page2.selectOption('#sfClass', '1R1');
await page2.click('#studentForm button[type="submit"]');
await page2.click('#saveBtn');
await page2.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
const bothSurvive = await page2.evaluate(() => {
  const wb = XLSX.read(window.__fs.get('half/namelist.xlsx').bytes, { type: 'array' });
  const m = window.NamelistSchema.workbookToModel(wb).model;
  return {
    theirs: m.students.some((s) => s.id === 'THEIRS-01'),
    mine: m.students.some((s) => s.name === 'MY OWN STUDENT'),
    backups: window.__fs.list().filter((p) => p.startsWith('half/backups/')).length,
  };
});
check('a first save over another admin\'s file keeps their students', bothSurvive.theirs,
  JSON.stringify(bothSurvive));
check('and keeps this admin\'s too', bothSurvive.mine);
check('and their version was backed up before anything was written',
  bothSurvive.backups > 0);

/* The setup screen promises "Nothing is written until you press Save".
 * Autosave used to ignore that and drop an empty workbook in the shared
 * folder about four seconds after the admin clicked in to look around. */
const page3 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page3.on('pageerror', (e) => errors.push('empty: ' + String(e)));
await page3.addInitScript(() => {
  const files = new Map();
  window.__fs = {
    get: (p) => files.get(p),
    list: () => Array.from(files.keys()),
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
          files.set(path, { bytes: new Uint8Array(buf), lastModified: 1 });
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
      if (!files.has(p)) files.set(p, { bytes: new Uint8Array(), lastModified: 0 });
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
  window.showDirectoryPicker = async () => mkDir('fresh/', 'Brand New Folder');
});
await page3.goto('file://' + demo + '/admin.html');
await page3.click('#openFolderBtn');
await page3.waitForSelector('#setupScreen:not([hidden])');
await page3.locator('#setupScreen details summary').click();   // "Other ways to start"
await page3.click('#setupEmptyBtn');
await page3.waitForSelector('#mainScreen:not([hidden])');
check('an empty start does not claim it is about to save itself',
  (await page3.locator('#dirtyNote').innerText()) === 'Unsaved changes',
  await page3.locator('#dirtyNote').innerText());
await page3.waitForTimeout(6000);      // well past the 4s autosave delay
check('and nothing is written to the folder until Save is pressed',
  (await page3.evaluate(() => window.__fs.list().length)) === 0,
  (await page3.evaluate(() => window.__fs.list().join(', '))) || '(empty)');
await page3.click('#saveBtn');
await page3.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
check('pressing Save writes it', await page3.evaluate(() => !!window.__fs.get('fresh/namelist.xlsx')));
await page3.click('#addStudentBtn');
await page3.fill('#sfName', 'Later Student');
await page3.click('#studentForm button[type="submit"]');
check('and from then on autosave is back in charge',
  (await page3.locator('#dirtyNote').innerText()).includes('saving shortly'),
  await page3.locator('#dirtyNote').innerText());

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All carry-over checks passed');
process.exit(failures.length ? 1 : 0);
