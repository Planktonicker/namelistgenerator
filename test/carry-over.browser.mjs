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
    async getDirectoryHandle(d) { return mkDir(prefix + d + '/', d); },
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
await page.waitForFunction(() => document.getElementById('dirtyNote').textContent === '');
check('Save writes both files into THIS folder', await page.evaluate(() =>
  !!window.__fs.get('new/namelist.xlsx') && !!window.__fs.get('new/data.js')));

// --- a folder with only a data.js can be rebuilt from it ---
const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page2.on('pageerror', (e) => errors.push('rebuild: ' + String(e)));
page2.on('dialog', (d) => d.accept());
await page2.addInitScript((js) => {
  const files = new Map();
  files.set('half/data.js', { bytes: new TextEncoder().encode(js), lastModified: 5 });
  window.__fs = { get: (p) => files.get(p), list: () => Array.from(files.keys()) };
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
    async getDirectoryHandle(d) { return mkDir(prefix + d + '/', d); },
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
await page2.waitForFunction(() => document.getElementById('dirtyNote').textContent === '');
check('Save then writes the workbook it was missing',
  await page2.evaluate(() => !!window.__fs.get('half/namelist.xlsx')));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All carry-over checks passed');
process.exit(failures.length ? 1 : 0);
