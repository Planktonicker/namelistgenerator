/* The app's own files can sit beside the two pages, or in a Data folder so a
 * teacher opening the drive sees two files rather than a pile. Both shapes are
 * real, and the editor moves one to the other on request. */
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

/* The same fake filesystem the other folder suites use: a flat map of paths,
 * with directory handles as prefix views over it. getDirectoryHandle refuses a
 * folder nothing lives in, which is the whole point here. */
const FAKE = () => {
  const files = new Map();
  window.__fs = {
    put: (p, b, t) => files.set(p, { bytes: b, at: t || Date.now() }),
    list: () => Array.from(files.keys()).sort(),
    has: (p) => files.has(p),
    drop: (p) => files.delete(p),
  };
  const mkFile = (path) => ({ kind: 'file', name: path.split('/').pop(),
    async getFile() {
      const r = files.get(path) || { bytes: new Uint8Array(), at: 0 };
      const blob = new Blob([r.bytes]);
      blob.lastModified = r.at;
      blob.name = path.split('/').pop();
      blob.arrayBuffer = async () => (r.bytes.buffer ? r.bytes.buffer : r.bytes);
      blob.text = async () => new TextDecoder().decode(r.bytes);
      return blob;
    },
    async createWritable() {
      let buf = null;
      return {
        async write(d) { buf = d; },
        async close() {
          const b = typeof buf === 'string' ? new TextEncoder().encode(buf)
            : buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
          files.set(path, { bytes: b, at: Date.now() });
        },
      };
    } });
  const mkDir = (prefix, name) => ({ kind: 'directory', name,
    async getFileHandle(f, o) {
      const p = prefix + f;
      if (!files.has(p) && !(o && o.create)) {
        const e = new Error('nf'); e.name = 'NotFoundError'; throw e;
      }
      if (!files.has(p)) window.__fs.put(p, new Uint8Array(), 0);
      return mkFile(p);
    },
    async getDirectoryHandle(d, o) {
      const dp = prefix + d + '/';
      let found = false;
      for (const k of files.keys()) { if (k.startsWith(dp)) { found = true; break; } }
      if (!found && !(o && o.create)) {
        const e = new Error('nf'); e.name = 'NotFoundError'; throw e;
      }
      return mkDir(dp, d);
    },
    async removeEntry(n, o) {
      if (files.has(prefix + n)) { files.delete(prefix + n); return; }
      const dp = prefix + n + '/';
      const hit = Array.from(files.keys()).filter((k) => k.startsWith(dp));
      if (!hit.length) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
      if (!(o && o.recursive)) throw new Error('not empty');
      hit.forEach((k) => files.delete(k));
    },
    async *values() {
      const seen = new Set();
      for (const p of files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest.includes('/')) { yield mkFile(p); continue; }
        const d = rest.split('/')[0];
        if (!seen.has(d)) { seen.add(d); yield { kind: 'directory', name: d }; }
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; } });
  window.__mkDir = mkDir;
  window.showDirectoryPicker = async () => mkDir('sandbox/', 'Sandbox');
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const errors = [];

async function open(seed) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(FAKE);
  await page.goto('file://' + demo + '/admin.html');
  if (seed) await page.evaluate(seed);
  await page.click('#openFolderBtn');
  await page.waitForTimeout(500);
  return page;
}

// ---------- a folder that has never heard of Data ----------
let page = await open();
check('an empty folder still offers the setup walkthrough',
  !(await page.locator('#setupScreen').isHidden()));
check('and reports the folder it was given, with no Data in the name',
  (await page.locator('#setupFolderName').innerText()) === 'Sandbox',
  await page.locator('#setupFolderName').innerText());

// "Start with an empty list" is the shortest route to a real first save
await page.locator('#setupScreen details summary').click();
await page.click('#setupEmptyBtn');
await page.waitForSelector('#mainScreen:not([hidden])');
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
await page.waitForTimeout(300);
let paths = await page.evaluate(() => window.__fs.list());
check('a flat folder saves beside the pages, exactly as it always did',
  paths.includes('sandbox/namelist.xlsx') && paths.includes('sandbox/data.js'),
  paths.join(', '));
check('and nothing was put in a Data folder',
  !paths.some((p) => p.startsWith('sandbox/Data/')), paths.join(', '));
check('the tidy button is offered while the folder is flat',
  !(await page.locator('#tidyFolderBtn').isHidden()));

// a second save, so there is a backup to carry across as well
await page.click('.tabs button[data-tab="teachers"]');
await page.click('#pasteTeachersBtn');
await page.fill('#pasteTeachersBox', 'Mrs Lim Bee Leng');
await page.click('#pasteTeachersForm button[type="submit"]');
await page.waitForTimeout(300);
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
await page.waitForTimeout(300);
paths = await page.evaluate(() => window.__fs.list());
check('and a second save keeps a backup beside them',
  paths.some((p) => p.startsWith('sandbox/backups/')), paths.join(', '));

// ---------- moving it ----------
await page.click('#tidyFolderBtn');
await page.waitForTimeout(900);
paths = await page.evaluate(() => window.__fs.list());
check('the workbook and data.js moved into Data',
  paths.includes('sandbox/Data/namelist.xlsx') && paths.includes('sandbox/Data/data.js'),
  paths.join(', '));
check('the originals are gone, not copied and left behind',
  !paths.includes('sandbox/namelist.xlsx') && !paths.includes('sandbox/data.js'),
  paths.join(', '));
check('the backups came with it',
  paths.some((p) => p.startsWith('sandbox/Data/backups/')) &&
  !paths.some((p) => p.startsWith('sandbox/backups/')),
  paths.filter((p) => p.includes('backups')).join(', '));
check('the topbar says where the data now lives',
  (await page.locator('#folderName').innerText()).includes('Data'),
  await page.locator('#folderName').innerText());
check('and the button retires itself once there is nothing left to tidy',
  await page.locator('#tidyFolderBtn').isHidden());

// another save, to prove writes now land inside Data rather than back on top
await page.click('.tabs button[data-tab="teachers"]');
await page.click('#pasteTeachersBtn');
await page.fill('#pasteTeachersBox', 'Mr Alvin Ong');
await page.click('#pasteTeachersForm button[type="submit"]');
await page.waitForTimeout(300);
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
await page.waitForTimeout(300);
paths = await page.evaluate(() => window.__fs.list());
check('saving after the move writes inside Data, not back at the top',
  paths.includes('sandbox/Data/namelist.xlsx') && !paths.includes('sandbox/namelist.xlsx'),
  paths.join(', '));
await page.close();

// ---------- a folder that already has Data ----------
page = await open(() => {
  window.__fs.put('sandbox/Data/namelist.xlsx', new Uint8Array([1]), Date.now());
});
check('a folder with Data in it is used as the data folder from the start',
  (await page.locator('#folderName').innerText()).includes('Data') ||
  (await page.locator('#setupFolderName').innerText()).includes('Data'),
  (await page.locator('#folderName').innerText()) + ' / ' +
  (await page.locator('#setupFolderName').innerText()));
check('and the tidy button is not offered — there is nothing to tidy',
  await page.locator('#tidyFolderBtn').isHidden());
await page.close();

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All data-folder checks passed');
process.exit(failures.length ? 1 : 0);
