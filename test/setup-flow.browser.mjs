/* First-run flow: an empty folder should ask which file is each level. */
import { chromium } from 'playwright';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
/* Any school allocation workbook works:
 *   ALLOCATION_XLSX=/path/to/file.xlsx node test/setup-flow.browser.mjs */
const SRC = process.env.ALLOCATION_XLSX;
if (!SRC) {
  console.log('set ALLOCATION_XLSX to a school workbook to run this test');
  process.exit(0);
}
const demo = join(mkdtempSync(join(tmpdir(), 'namelist-')), 'setup');
mkdirSync(demo, { recursive: true });
copyFileSync(join(repo, 'dist/admin.html'), join(demo, 'admin.html'));

const failures = [];
const check = (n, c, extra) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (extra ? ' [' + extra + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());

// fake filesystem: an EMPTY data folder + a school folder holding one real file
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
  // first pick = the app's (empty) data folder, second = the school folder
  let picks = 0;
  window.showDirectoryPicker = async () =>
    (picks++ === 0 ? mkDir('data/', 'Namelist') : mkDir('school/', 'Subject Grouping List'));
});

await page.goto('file://' + demo + '/admin.html');
const xlsx = readFileSync(SRC);
await page.evaluate((bytes) => {
  window.__fs.put('school/S3 allocation (whatever name).xlsx', new Uint8Array(bytes), 1000);
}, Array.from(xlsx));

// open the empty data folder -> setup screen
await page.click('#openFolderBtn');
await page.waitForSelector('#setupScreen:not([hidden])');
const setupText = await page.locator('#setupScreen').innerText();
check('setup screen leads with the level files',
  /Choose the level files/i.test(await page.locator('#setupLevelsBtn').innerText()));
check('the raw-import path is tucked away, not the headline',
  !setupText.includes('Import one document') &&
  (await page.locator('#setupImportBtn').count()) === 1);
check('setup screen names the folder', setupText.includes('Namelist'));

// the one button should ask for the level files, one level at a time
await page.click('#setupLevelsBtn');
await page.waitForSelector('#pickFileDialog[open]');
check('it asks which file is Sec 1', (await page.locator('#pickLevelName').innerText()) === 'Sec 1');
check('the picker lists the school folder\'s files',
  (await page.locator('#pickTable tbody tr').innerText()).includes('S3 allocation'));
check('Sec 1-5 were all created', (await page.locator('#sourcesTable tbody tr').count()) === 5);

// pick a file for Sec 1 -> review its columns -> it imports and moves on to Sec 2
await page.locator('#pickTable tbody tr').first().locator('button[data-act="use"]').click();
await page.waitForSelector('#mapDialog[open]');
check('the first import of a level asks you to check the columns',
  (await page.locator('#mapLevelName').innerText()) === 'Sec 1');
await page.click('#mapGoBtn');
await page.waitForFunction(() =>
  document.getElementById('pickLevelName').textContent === 'Sec 2' &&
  document.getElementById('pickFileDialog').open);
check('after picking, it asks for the next level', true);
check('the picked level actually imported',
  parseInt(await page.locator('#countStudents').innerText(), 10) > 0);

// cancelling stops the walkthrough rather than nagging
await page.click('#pickCancelBtn');
await page.waitForTimeout(200);
check('Cancel ends the walkthrough', !(await page.locator('#pickFileDialog').isVisible()));
const rows = await page.locator('#sourcesTable tbody tr').allInnerTexts();
check('Sec 1 shows its file, the rest still say pick a file',
  rows[0].includes('S3 allocation') && rows[1].includes('not chosen yet'));
check('no JS errors', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 3));

await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All setup-flow checks passed');
process.exit(failures.length ? 1 : 0);
