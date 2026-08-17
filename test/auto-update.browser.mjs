/* Opening the editor must refresh the levels by itself and republish data.js. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Any school level file works:
 *   ALLOCATION_XLSX=/path/to/file.xlsx node test/auto-update.browser.mjs */
const SRC = process.env.ALLOCATION_XLSX;
if (!SRC) { console.log('set ALLOCATION_XLSX to a school workbook to run this test'); process.exit(0); }
const demo = join(mkdtempSync(join(tmpdir(), 'namelist-')), 'auto');
mkdirSync(demo, { recursive: true });
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));
const failures = [];
const check = (n, c, x) => { console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : '')); if (!c) failures.push(n); };

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

await page.addInitScript(() => {
  const files = new Map();
  window.__fs = { put: (p, b, lm) => files.set(p, { bytes: new Uint8Array(b), lastModified: lm }),
    get: (p) => files.get(p), list: () => [...files.keys()] };
  const mkFile = (path) => ({ kind: 'file', name: path.split('/').pop(),
    async getFile() { const r = files.get(path);
      return new File([r ? r.bytes : new Uint8Array()], path.split('/').pop(), { lastModified: r ? r.lastModified : 0 }); },
    async createWritable() { const c = []; return { async write(d) { c.push(d); },
      async close() { files.set(path, { bytes: new Uint8Array(await new Blob(c).arrayBuffer()), lastModified: Date.now() }); } }; },
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } });
  const mkDir = (prefix, name) => ({ kind: 'directory', name,
    async getFileHandle(f, o) { const p = prefix + f;
      if (!files.has(p) && !(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
      if (!files.has(p)) window.__fs.put(p, new Uint8Array(), 0); return mkFile(p); },
    async getDirectoryHandle(d) { return mkDir(prefix + d + '/', d); },
    async *values() { for (const p of files.keys())
      if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) yield mkFile(p); },
    async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; } });
  let picks = 0;
  window.showDirectoryPicker = async () => (picks++ === 0 ? mkDir('data/', 'Namelist') : mkDir('school/', 'School'));
});

await page.goto('file://' + demo + '/admin.html');
await page.evaluate((b) => window.__fs.put('school/Sec 1 list.xlsx', new Uint8Array(b), Date.parse('2026-01-14')),
  Array.from(readFileSync(SRC)));

// first run: pick folder, register + import Sec 1, save
await page.click('#openFolderBtn');
await page.waitForSelector('#setupScreen:not([hidden])');
await page.click('#setupLevelsBtn');
await page.waitForSelector('#pickFileDialog[open]');
await page.locator('#pickTable tbody tr').first().locator('button[data-act="use"]').click();
await page.waitForSelector('#mapDialog[open]');
await page.click('#mapGoBtn');
await page.waitForFunction(() => +document.getElementById('countStudents').textContent > 0);
// the walkthrough moves on to Sec 2; stop it before saving
await page.waitForTimeout(600);
await page.evaluate(() => { const d = document.getElementById('pickFileDialog'); if (d.open) d.close(); });
await page.waitForTimeout(200);
await page.click('#saveBtn');
await page.waitForFunction(() => !/Unsaved/.test(document.getElementById('dirtyNote').textContent));
const total = await page.locator('#countStudents').innerText();
check('first run imported and saved', +total > 0, total);
check('auto-check ran on open, with no prompting',
  !(await page.locator('#updateCheckBar').isHidden()) &&
  /up to date/.test(await page.locator('#updateCheckText').innerText()));
const jsBefore = await page.evaluate(() =>
  new TextDecoder().decode(window.__fs.get('data/data.js').bytes));

// the office publishes a newer file; the app must pick it up by itself
await page.evaluate((b) => window.__fs.put('school/Sec 1 list.xlsx', new Uint8Array(b), Date.now()),
  Array.from(readFileSync(SRC)));
const dialogsBefore = dialogs.length;
await page.click('#updateCheckBtn');          // same path the page-load check takes
await page.waitForFunction(
  () => /Updated from the school files/.test(document.getElementById('updateCheckText').textContent),
  null, { timeout: 20000 });
check('it re-imported the newer file without asking anything',
  dialogs.length === dialogsBefore, dialogs.slice(dialogsBefore).join('|'));
check('the bar reports what changed',
  /Sec 1: \d+ updated/.test(await page.locator('#updateCheckText').innerText()),
  await page.locator('#updateCheckText').innerText());
check('student count unchanged (matched, not duplicated)',
  (await page.locator('#countStudents').innerText()) === total);
check('it saved by itself — nothing left unsaved',
  !(await page.locator('#dirtyNote').innerText()).includes('Unsaved'));
const jsAfter = await page.evaluate(() =>
  new TextDecoder().decode(window.__fs.get('data/data.js').bytes));
check('data.js was republished for teachers',
  jsAfter.includes('NAMELIST_DATA') && jsAfter !== jsBefore);
check('a backup was kept before the automatic save',
  (await page.evaluate(() => window.__fs.list().filter((p) => p.startsWith('data/backups/')).length)) > 0);
check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All auto-update checks passed');
process.exit(failures.length ? 1 : 0);
