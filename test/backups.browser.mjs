/* backups\ is the only safety net there is. Two halves of one job: the folder
 * must not grow forever, and a bad afternoon must be undoable from inside the
 * editor rather than by copying files about in Explorer. */
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

/* The folder suites' fake filesystem, plus a `get` so a test can take a copy
 * of a real workbook and file it under an older name. */
const FAKE = () => {
  const files = new Map();
  window.__fs = {
    put: (p, b, t) => files.set(p, { bytes: b, at: t || Date.now() }),
    get: (p) => files.get(p),
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
      for (const p of Array.from(files.keys())) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest.includes('/')) { yield mkFile(p); continue; }
        const d = rest.split('/')[0];
        if (!seen.has(d)) { seen.add(d); yield { kind: 'directory', name: d }; }
      }
    },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; } });
  window.showDirectoryPicker = async () => mkDir('sandbox/', 'Sandbox');
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const errors = [];

async function open() {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(FAKE);
  await page.goto('file://' + demo + '/admin.html');
  await page.click('#openFolderBtn');
  await page.waitForTimeout(400);
  return page;
}

const saved = (page) =>
  page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));

async function addClass(page, name) {
  await page.locator('.tabs button[data-tab="groups"]').click();
  await page.click('#addGroupBtn');
  await page.fill('#gfName', name);
  await page.click('#groupForm button[type="submit"]');
  await page.waitForTimeout(300);
}

async function addTeacher(page, name) {
  await page.click('.tabs button[data-tab="teachers"]');
  await page.click('#pasteTeachersBtn');
  await page.fill('#pasteTeachersBox', name);
  await page.click('#pasteTeachersForm button[type="submit"]');
  await page.waitForTimeout(200);
}

const listBackups = (page) => page.evaluate(() => window.__fs.list()
  .filter((p) => p.startsWith('sandbox/backups/'))
  .map((p) => p.split('/').pop()));

/* ---------- a folder with one teacher in it, saved ---------- */

let page = await open();
await page.locator('#setupScreen details summary').click();
await page.click('#setupEmptyBtn');
await page.waitForSelector('#mainScreen:not([hidden])');
await addTeacher(page, 'Mrs Lim Bee Leng');
await page.click('#saveBtn');
await saved(page);
await page.waitForTimeout(200);

check('the backups button waits until there is a save to go back to',
  !(await page.locator('#backupsBtn').isHidden()));

/* Eight copies of that workbook, all filed under one January day. Nothing
 * about pruning depends on when the copy was made — only on the time in the
 * name, which is the time the copy is OF. */
await page.evaluate(() => {
  const src = window.__fs.get('sandbox/namelist.xlsx');
  for (let h = 8; h < 16; h++) {
    const hh = String(h).padStart(2, '0');
    window.__fs.put('sandbox/backups/namelist-20260101-' + hh + '0000.xlsx', src.bytes, 1);
  }
});
check('eight copies of one January day are sitting there',
  (await listBackups(page)).length === 8);

/* ---------- the next save prunes ---------- */

await addTeacher(page, 'Mr Alvin Ong');
await addTeacher(page, 'Mdm Halimah Yusof');
await addClass(page, 'Sec 3 Lit A');
await page.click('#saveBtn');
await saved(page);
await page.waitForTimeout(300);

let names = await listBackups(page);
const jan = names.filter((n) => n.includes('20260101')).sort();
check('the pile is pruned on the next save', names.length === 4, names.join(', '));
check('what January kept is the one the day opened with, and the two newest',
  jan.join(',') === ['namelist-20260101-080000.xlsx', 'namelist-20260101-140000.xlsx',
    'namelist-20260101-150000.xlsx'].join(','), jan.join(', '));
check('and the save left a copy of what it replaced',
  names.some((n) => !n.includes('20260101')), names.join(', '));

/* ---------- what the dialog says ---------- */

await page.click('#backupsBtn');
await page.waitForTimeout(300);
let rows = await page.locator('#backupsTable tbody tr').count();
check('the dialog lists every backup', rows === 4, String(rows));
let radios = await page.locator('#backupsTable input[name="backupPick"]').evaluateAll(
  (els) => els.map((e) => e.value));
check('newest first', radios[0] > radios[radios.length - 1], radios.join(', '));
check('and the oldest listed is the one January opened with',
  radios[radios.length - 1] === 'namelist-20260101-080000.xlsx', radios.join(', '));

await page.locator('#backupsTable input[value="namelist-20260101-080000.xlsx"]').check();
await page.waitForTimeout(400);
check('picking one says what is in it, not just when it was',
  /students/.test(await page.locator('#backupsNote').innerText()),
  await page.locator('#backupsNote').innerText());

/* ---------- going back ---------- */

check('three teachers and a class before the restore',
  (await page.locator('#countTeachers').innerText()) === '3' &&
  (await page.locator('#countGroups').innerText()) === '1',
  (await page.locator('#countTeachers').innerText()) + ' / ' +
  (await page.locator('#countGroups').innerText()));

await page.click('#backupsRestoreBtn');
await page.waitForTimeout(900);

check('the roll on screen is the one from the backup',
  (await page.locator('#countTeachers').innerText()) === '1' &&
  (await page.locator('#countGroups').innerText()) === '0',
  (await page.locator('#countTeachers').innerText()) + ' / ' +
  (await page.locator('#countGroups').innerText()));
check('and it was written out, not merely shown',
  await page.evaluate(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent)),
  await page.locator('#dirtyNote').innerText());

const dataJs = await page.evaluate(() =>
  new TextDecoder().decode(window.__fs.get('sandbox/data.js').bytes));
check('data.js was republished, so teachers see the roll that is now real',
  !dataJs.includes('Sec 3 Lit A'), dataJs.slice(0, 160));

names = await listBackups(page);
check('the copy it was restored from is still there',
  names.includes('namelist-20260101-080000.xlsx'), names.join(', '));
check('and what the restore replaced was backed up first, so this can be undone too',
  names.filter((n) => !n.includes('20260101')).length >= 1, names.join(', '));

check('undo does not offer to put the replaced roll back',
  await page.locator('#undoBtn').isDisabled());

await page.close();

/* ---------- not while somebody else is in the folder ---------- */

page = await open();
await page.locator('#setupScreen details summary').click();
await page.click('#setupEmptyBtn');
await page.waitForSelector('#mainScreen:not([hidden])');
await addTeacher(page, 'Mrs Lim Bee Leng');
await page.click('#saveBtn');
await saved(page);
await page.waitForTimeout(200);
await page.evaluate(() => {
  const src = window.__fs.get('sandbox/namelist.xlsx');
  window.__fs.put('sandbox/backups/namelist-20260101-080000.xlsx', src.bytes, 1);
});
await addTeacher(page, 'Mr Alvin Ong');
await page.click('#saveBtn');
await saved(page);
await page.waitForTimeout(200);

await page.evaluate(() => {
  window.__fs.put('sandbox/presence/zzz.txt',
    new TextEncoder().encode(JSON.stringify({ name: 'Mrs Wong', at: Date.now(), tab: 'groups' })));
});
await page.evaluate(() => window.__beatNowForTest());
await page.waitForTimeout(300);
check('the topbar knows somebody else is in',
  !(await page.locator('#presenceChip').isHidden()));

await page.click('#backupsBtn');
await page.waitForTimeout(300);
await page.locator('#backupsTable input[value="namelist-20260101-080000.xlsx"]').check();
await page.waitForTimeout(300);
await page.click('#backupsRestoreBtn');
await page.waitForTimeout(600);
check('a restore is refused while another admin has the folder open',
  (await page.locator('#countTeachers').innerText()) === '2',
  await page.locator('#countTeachers').innerText());
check('and the dialog is still up, so nothing was silently swallowed',
  await page.evaluate(() => document.getElementById('backupsDialog').open));

await page.close();

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All backups checks passed');
process.exit(failures.length ? 1 : 0);
