/* Exercises the REAL save path of dist/admin.html — folder handles, conflict
 * detection, backups and data.js regeneration — against an in-memory fake
 * File System Access API, which is the only way to drive the folder picker
 * without a human. Documents what happens when the workbook is changed
 * outside the app while an admin is editing it.
 *
 * Needs Playwright + Chromium:
 *   PLAYWRIGHT_CHROMIUM=/path/to/chromium node test/conflict.browser.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const check = (name, cond, extra) => {
  console.log((cond ? '  ok - ' : '  FAIL - ') + name + (extra ? ' [' + extra + ']' : ''));
  if (!cond) failures.push(name);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

// Install the fake filesystem BEFORE the page script runs.
await page.addInitScript(() => {
  const files = new Map();   // path -> { bytes: Uint8Array, lastModified: number }
  let clock = 1000;
  window.__fs = {
    files,
    put(path, bytes, lm) { files.set(path, { bytes: new Uint8Array(bytes), lastModified: lm == null ? ++clock : lm }); },
    get(path) { return files.get(path); },
    list() { return Array.from(files.keys()); },
    tick() { return ++clock; },
  };

  function makeFileHandle(path) {
    return {
      kind: 'file',
      name: path.split('/').pop(),
      async getFile() {
        const rec = files.get(path);
        const bytes = rec ? rec.bytes : new Uint8Array();
        return new File([bytes], path.split('/').pop(), { lastModified: rec ? rec.lastModified : 0 });
      },
      async createWritable() {
        const chunks = [];
        return {
          async write(d) { chunks.push(d); },
          async close() {
            const blob = new Blob(chunks);
            const buf = await blob.arrayBuffer();
            window.__fs.put(path, new Uint8Array(buf));
          },
        };
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
  }

  function makeDirHandle(prefix, name) {
    return {
      kind: 'directory',
      name,
      async getFileHandle(fname, opts) {
        const path = prefix + fname;
        if (!files.has(path) && !(opts && opts.create)) {
          const err = new Error('NotFoundError'); err.name = 'NotFoundError'; throw err;
        }
        if (!files.has(path)) window.__fs.put(path, new Uint8Array());
        return makeFileHandle(path);
      },
      async getDirectoryHandle(dname) { return makeDirHandle(prefix + dname + '/', dname); },
      async *values() {
        for (const p of files.keys()) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length);
          if (rest.includes('/')) continue;
          yield makeFileHandle(p);
        }
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
  }
  window.__makeDirHandle = makeDirHandle;
  window.showDirectoryPicker = async () => makeDirHandle('data/', 'NamelistData');
});

await page.goto('file://' + repo + '/dist/admin.html');

// Seed the folder with a namelist.xlsx built from the sample model.
const sampleDataJs = readFileSync(repo + '/sample/data.js', 'utf8');
await page.evaluate(sampleDataJs);
await page.evaluate(() => {
  const d = window.NAMELIST_DATA;
  const model = {
    students: d.students, groups: d.groups, memberships: d.memberships,
    subjectKeys: d.subjectKeys, sources: [],
  };
  const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(model), { bookType: 'xlsx', type: 'array' });
  window.__fs.put('data/namelist.xlsx', new Uint8Array(bytes), 5000);
});

// ---- open the folder for real, through the app's own button ----
await page.click('#openFolderBtn');
await page.waitForSelector('#mainScreen:not([hidden])');
check('opens the folder and loads namelist.xlsx', (await page.locator('#countStudents').innerText()) === '156');

// ---- clean save (no conflict) ----
await page.click('#addStudentBtn');
await page.fill('#sfName', 'Alpha Admin');
await page.selectOption('#sfClass', '1R1');
await page.click('#studentForm button[type="submit"]');
let sawDialog = null;
page.on('dialog', async (d) => { sawDialog = d.message(); await d.accept(); });
await page.click('#saveBtn');
await page.waitForFunction(() => document.getElementById('dirtyNote').textContent === '');
check('clean save writes namelist.xlsx + data.js', await page.evaluate(
  () => !!window.__fs.get('data/namelist.xlsx') && !!window.__fs.get('data/data.js')));
check('clean save shows no conflict warning', sawDialog === null, String(sawDialog));
check('backup of the previous version was kept', await page.evaluate(
  () => window.__fs.list().some((p) => p.startsWith('data/backups/'))));
check('data.js reflects the new student', await page.evaluate(async () => {
  const rec = window.__fs.get('data/data.js');
  const text = new TextDecoder().decode(rec.bytes);
  const w = {}; new Function('window', text)(w);
  return w.NAMELIST_DATA.students.some((s) => s.name === 'Alpha Admin');
}));

// ---- someone edits the Excel directly while the admin keeps working ----
await page.evaluate(() => {
  // Rebuild the workbook as if edited in Excel: one student renamed.
  const rec = window.__fs.get('data/namelist.xlsx');
  const wb = XLSX.read(rec.bytes, { type: 'array' });
  const res = window.NamelistSchema.workbookToModel(wb);
  res.model.students[0].name = 'EDITED IN EXCEL';
  const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(res.model), { bookType: 'xlsx', type: 'array' });
  window.__fs.put('data/namelist.xlsx', new Uint8Array(bytes), 999999);   // newer timestamp
});
// admin makes another change in the HTML, unaware
await page.click('#addStudentBtn');
await page.fill('#sfName', 'Beta Admin');
await page.selectOption('#sfClass', '1R2');
await page.click('#studentForm button[type="submit"]');

// ---- conflict: Cancel path ----
sawDialog = null;
page.removeAllListeners('dialog');
page.on('dialog', async (d) => { sawDialog = d.message(); await d.dismiss(); });
const beforeCancel = await page.evaluate(() => window.__fs.get('data/namelist.xlsx').lastModified);
await page.click('#saveBtn');
await page.waitForTimeout(400);
check('conflict is detected on save', !!sawDialog && sawDialog.includes('changed by someone else'), String(sawDialog).slice(0, 60));
check('Cancel leaves the file on disk untouched', await page.evaluate(
  (lm) => window.__fs.get('data/namelist.xlsx').lastModified === lm, beforeCancel));
check('Cancel keeps the admin\'s unsaved changes in the page',
  (await page.locator('#dirtyNote').innerText()) === 'Unsaved changes' &&
  (await page.locator('#countStudents').innerText()) === '158');

// ---- conflict: OK (overwrite) path ----
const backupsBefore = await page.evaluate(() => window.__fs.list().filter((p) => p.startsWith('data/backups/')).length);
sawDialog = null;
page.removeAllListeners('dialog');
page.on('dialog', async (d) => { sawDialog = d.message(); await d.accept(); });
await page.click('#saveBtn');
await page.waitForFunction(() => document.getElementById('dirtyNote').textContent === '');
const after = await page.evaluate(() => {
  const backups = window.__fs.list().filter((p) => p.startsWith('data/backups/'));
  const live = XLSX.read(window.__fs.get('data/namelist.xlsx').bytes, { type: 'array' });
  const liveModel = window.NamelistSchema.workbookToModel(live).model;
  const newest = backups.sort()[backups.length - 1];
  const bk = XLSX.read(window.__fs.get(newest).bytes, { type: 'array' });
  const bkModel = window.NamelistSchema.workbookToModel(bk).model;
  return {
    backups: backups.length,
    liveHasExcelEdit: liveModel.students.some((s) => s.name === 'EDITED IN EXCEL'),
    liveHasHtmlEdits: liveModel.students.some((s) => s.name === 'Alpha Admin') &&
      liveModel.students.some((s) => s.name === 'Beta Admin'),
    backupHasExcelEdit: bkModel.students.some((s) => s.name === 'EDITED IN EXCEL'),
  };
});
check('overwrite backs up the other person\'s version first', after.backups === backupsBefore + 1);
check('that backup CONTAINS the Excel edit (nothing is lost)', after.backupHasExcelEdit);
check('live file now has the HTML edits', after.liveHasHtmlEdits);
check('live file LOST the Excel edit (last writer wins)', after.liveHasExcelEdit === false);

// ---- editing the Excel directly does NOT refresh data.js ----
const drift = await page.evaluate(() => {
  const rec = window.__fs.get('data/namelist.xlsx');
  const wb = XLSX.read(rec.bytes, { type: 'array' });
  const model = window.NamelistSchema.workbookToModel(wb).model;
  model.students[0].name = 'LATER EXCEL EDIT';
  const bytes = XLSX.write(window.NamelistSchema.modelToWorkbook(model), { bookType: 'xlsx', type: 'array' });
  window.__fs.put('data/namelist.xlsx', new Uint8Array(bytes), 1234567);
  const text = new TextDecoder().decode(window.__fs.get('data/data.js').bytes);
  const w = {}; new Function('window', text)(w);
  return {
    xlsxHas: true,
    dataJsHas: w.NAMELIST_DATA.students.some((s) => s.name === 'LATER EXCEL EDIT'),
  };
});
check('DRIFT: a direct Excel edit is NOT reflected in data.js', drift.dataJsHas === false);

check('no JS errors', errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All conflict checks passed');
process.exit(failures.length ? 1 : 0);
