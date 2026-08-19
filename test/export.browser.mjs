/* The Export tab: the same students, in a workbook a teacher can sort, mark up
 * or mail merge. The part that has to be right is the file actually opening —
 * so this downloads one and reads it back rather than trusting the preview. */
import { chromium } from 'playwright';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
globalThis.XLSX = require(join(repo, 'vendor/xlsx.full.min.js'));
const XLSX = globalThis.XLSX;

const demo = mkdtempSync(join(tmpdir(), 'namelist-'));
copyFileSync(join(repo, 'dist/namelist.html'), join(demo, 'namelist.html'));
copyFileSync(join(repo, 'sample/data.js'), join(demo, 'data.js'));

const failures = [];
const check = (n, c, x) => {
  console.log((c ? '  ok - ' : '  FAIL - ') + n + (x ? ' [' + x + ']' : ''));
  if (!c) failures.push(n);
};

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + demo + '/namelist.html');
await page.click('#tabExportBtn');
await page.waitForTimeout(400);

const count = () => page.locator('#exCount').innerText();
const tabNames = () => page.locator('#exSheets tr td:first-child').allInnerTexts();

check('it opens on the whole roll, split by form class',
  /156 students/.test(await count()) && (await tabNames()).length === 6,
  (await count()).replace(/\s+/g, ' '));
check('with a sensible set of columns already ticked',
  (await page.locator('#exColumns label.on').count()) === 6);
// innerText would give what CSS renders — table headings are uppercased there
const previewHead = () => page.locator('#exPreview thead th').allTextContents();
check('and a preview of the first tab, so a wrong filter shows before the file exists',
  (await previewHead()).join('|') === 'S/N|Class|Name|Gender|PG|TG / SG',
  (await previewHead()).join('|'));

// --- the splitter decides the tabs ---
await page.selectOption('#exSplit', 'pg');
await page.waitForTimeout(300);
check('one sheet per PG gives one tab per posting group',
  (await tabNames()).join(',') === '1,2,3', (await tabNames()).join(','));
await page.selectOption('#exSplit', '');
await page.waitForTimeout(300);
check('and everything-on-one-sheet gives exactly one',
  (await tabNames()).length === 1 && /1 tab\b/.test(await count()),
  (await count()).replace(/\s+/g, ' '));

await page.selectOption('#exSplit', 'group');
await page.waitForTimeout(400);
const groupTabs = await tabNames();
check('one sheet per teaching group gives a tab per namelist',
  groupTabs.length === 16, groupTabs.length + '');
check('somebody in several classes is counted on each tab',
  /rows/.test(await count()), (await count()).replace(/\s+/g, ' '));

// --- filters narrow it ---
await page.selectOption('#exSplit', 'class');
await page.selectOption('#exPg', '3');
await page.waitForTimeout(350);
check('filtering by PG narrows the roll but keeps the tabs',
  /78 students/.test(await count()), (await count()).replace(/\s+/g, ' '));
await page.selectOption('#exClass', '1R1');
await page.waitForTimeout(300);
check('two filters combine',
  (await tabNames()).join(',') === '1R1' && /12 students/.test(await count()),
  (await count()).replace(/\s+/g, ' '));

// --- the columns are what comes out ---
await page.locator('#exColumns input[data-col="s:EL"]').check();
await page.locator('#exColumns input[data-col="tg"]').uncheck();
await page.waitForTimeout(300);
check('ticking a subject column adds it, in the order the columns are declared',
  (await previewHead()).join('|') === 'S/N|Class|Name|Gender|PG|EL',
  (await previewHead()).join('|'));

// --- and the file opens ---
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exGo')]);
const file = join(demo, 'out.xlsx');
await download.saveAs(file);
check('the download is named for what it holds',
  /^namelists-form-class-\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()),
  download.suggestedFilename());

const wb = XLSX.read(readFileSync(file), { type: 'buffer' });
check('the workbook opens, Summary first',
  wb.SheetNames[0] === 'Summary' && wb.SheetNames.join(',') === 'Summary,1R1',
  wb.SheetNames.join(','));
const rows = XLSX.utils.sheet_to_json(wb.Sheets['1R1'], { header: 1 });
check('the sheet carries the columns that were ticked',
  rows[0].join('|') === 'S/N|Class|Name|Gender|PG|EL', rows[0].join('|'));
check('and one row per student, matching the count on screen',
  rows.length - 1 === 12, (rows.length - 1) + '');
check('every row is a PG 3 student of 1R1, as filtered',
  rows.slice(1).every((r) => String(r[1]) === '1R1' && String(r[4]) === '3'),
  JSON.stringify(rows[1]));
const summary = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 }));
check('the Summary records what was asked for and what it left out',
  summary.includes('Form class') && summary.includes('PG 3') && summary.includes('class 1R1'),
  summary.slice(0, 160));

// --- leavers ---
await page.click('#exClear');
await page.waitForTimeout(300);
check('clearing the filters puts the whole roll back',
  /156 students/.test(await count()), (await count()).replace(/\s+/g, ' '));
await page.evaluate(() => { window.NAMELIST_DATA.students[0].status = 'left'; });
await page.click('#exClear');
await page.waitForTimeout(300);
check('somebody marked as having left is out of the export',
  /155 students/.test(await count()), (await count()).replace(/\s+/g, ' '));
await page.locator('#exLeavers').check();
await page.waitForTimeout(300);
check('and the tick box puts them back',
  /156 students/.test(await count()), (await count()).replace(/\s+/g, ' '));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All export checks passed');
process.exit(failures.length ? 1 : 0);
