/* The printed namelist: the space beside the names is split into equal boxes
 * to mark in, there is room under the last name for late arrivals, and a
 * class is fitted onto one sheet rather than spilling four names onto a
 * second one. */
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

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('file://' + demo + '/admin.html');

/* Three sizes: one that fits with room to spare, one that only just fits, and
 * one no amount of shrinking gets onto a single readable page. */
await page.evaluate(() => {
  const students = [];
  const mk = (i, group, name) => students.push({
    id: 'S' + i, name, class: '1R1', level: 'Sec 1', gender: i % 2 ? 'F' : 'M',
    pg: '2', tg: '', sn: String(i), origin: 'file', sourceName: name, status: '',
    subjects: { EL: 'EL G2' }, group,
  });
  let i = 0;
  for (let k = 0; k < 26; k++) mk(++i, 'SMALL', 'TAN WEI MING ' + (k + 1));
  for (let k = 0; k < 40; k++) mk(++i, 'MID', 'LIM SIEW HONG ' + (k + 1));
  for (let k = 0; k < 90; k++) mk(++i, 'BIG', 'NUR AISYAH BINTE HASSAN ' + (k + 1));
  window.__loadModelForTest({
    students: students.map((s) => { const c = Object.assign({}, s); delete c.group; return c; }),
    groups: ['SMALL', 'MID', 'BIG'].map((code) => ({ code, name: code + ' class',
      subject: 'English Language', teachers: ['Mrs Lim'], level: 'Sec 1',
      autoMatch: '', autoPg: '', autoTg: '', autoClasses: '' })),
    memberships: students.map((s) => ({ studentId: s.id, groupCode: s.group })),
    subjectKeys: ['EL'], sources: [], teachers: ['Mrs Lim'],
    subjectLabels: ['English Language'], requests: [],
  });
});

const sheet = await page.evaluate(() => {
  const S = window.NamelistSchema;
  const m = window.__testModel();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const el = document.getElementById('printSheet');
  el.innerHTML = m.groups.map((g) => {
    const members = m.memberships.filter((x) => x.groupCode === g.code)
      .map((x) => m.students.find((s) => s.id === x.studentId));
    return '<div class="card" data-code="' + g.code + '">' +
      S.namelistPrintHtml(g, members, esc, { note: g.name }) + '</div>';
  }).join('');
  S.fitPrintSheet(el);

  // measure with the sheet laid out exactly as it will print
  el.classList.add('measuring');
  el.style.width = (186 * 96 / 25.4) + 'px';
  const pageH = (297 - 28) * 96 / 25.4;
  const out = { pageW: 186 * 96 / 25.4, pageH, cards: {} };
  // Measured with the scaling off, so "does it fit" is zoom x height, not a
  // guess about which coordinate space getBoundingClientRect reports in.
  const naturalHeight = (card) => {
    const z = card.style.zoom;
    card.style.zoom = '';
    const h = card.getBoundingClientRect().height;
    card.style.zoom = z;
    return h;
  };
  el.querySelectorAll('.card').forEach((card) => {
    const table = card.querySelector('.namelist');
    const heads = Array.from(table.querySelectorAll('thead th.nl-box'));
    const last = heads[heads.length - 1];
    const nameCell = table.querySelector('tbody .nl-name');
    out.cards[card.dataset.code] = {
      boxes: heads.length,
      widths: heads.map((h) => Math.round(h.getBoundingClientRect().width * 100) / 100),
      rightEdge: last ? last.getBoundingClientRect().right - table.getBoundingClientRect().left : 0,
      tableWidth: table.getBoundingClientRect().width,
      nameWidth: nameCell ? nameCell.getBoundingClientRect().width : 0,
      blanks: table.querySelectorAll('tr.nl-blank').length,
      rowH: table.querySelector('tbody tr:not(.nl-blank)').getBoundingClientRect().height,
      blankH: Array.from(table.querySelectorAll('tr.nl-blank'))
        .map((r) => Math.round(r.getBoundingClientRect().height * 100) / 100),
      hasNote: table.querySelectorAll('.nl-note').length,
      zoom: card.style.zoom || '',
      rowpad: card.style.getPropertyValue('--nl-rowpad') || '5px',
      rowlh: card.style.getPropertyValue('--nl-rowlh') || '1.5',
      height: naturalHeight(card),
    };
  });
  el.classList.remove('measuring');
  el.style.width = '';
  return out;
});

const mm = 96 / 25.4;
console.log('  heights:', JSON.stringify(Object.keys(sheet.cards).map((k) =>
  k + '=' + Math.round(sheet.cards[k].height) + ' pad ' + sheet.cards[k].rowpad),
) + ' page=' + Math.round(sheet.pageH));
const small = sheet.cards.SMALL, mid = sheet.cards.MID, big = sheet.cards.BIG;

check('the space beside the names is split into more than one box',
  small.boxes >= 2, JSON.stringify({ boxes: small.boxes }));
check('every box is the same width, and it is the width asked for (14mm)',
  new Set(small.widths).size === 1 && Math.abs(small.widths[0] - 14 * mm) < 1.5,
  small.widths[0].toFixed(1) + 'px vs ' + (14 * mm).toFixed(1) + 'px');
check('the boxes finish flush at the right margin',
  Math.abs(small.rightEdge - small.tableWidth) < 1.5,
  small.rightEdge.toFixed(1) + ' vs ' + small.tableWidth.toFixed(1));
check('the table is the full printable width',
  Math.abs(small.tableWidth - sheet.pageW) < 1.5,
  small.tableWidth.toFixed(1) + ' vs ' + sheet.pageW.toFixed(1));
check('a longer name leaves room for fewer boxes',
  big.boxes < small.boxes && big.nameWidth > small.nameWidth,
  'SMALL ' + small.boxes + ' boxes / name ' + Math.round(small.nameWidth) +
  'px, BIG ' + big.boxes + ' boxes / name ' + Math.round(big.nameWidth) + 'px');
check('the Note column is gone from the printed list',
  small.hasNote === 0 && big.hasNote === 0);

check('there are five blank lines under the last name',
  small.blanks === 5 && mid.blanks === 5 && big.blanks === 5,
  [small.blanks, mid.blanks, big.blanks].join(','));
check('and each is the same height as a row with a name in it',
  [small, mid, big].every((c) =>
    new Set(c.blankH).size === 1 && Math.abs(c.blankH[0] - c.rowH) < 0.5),
  [small, mid, big].map((c) => c.blankH[0] + ' vs ' + Math.round(c.rowH * 100) / 100).join(' · '));
check('including after the rows have been tightened to fit the page',
  Math.abs(mid.blankH[0] - mid.rowH) < 0.5 && mid.rowH < small.rowH,
  'tightened row ' + Math.round(mid.rowH * 100) / 100 +
  ' vs a roomier ' + Math.round(small.rowH * 100) / 100);

const onPage = (c) => c.height * (parseFloat(c.zoom) || 1) <= sheet.pageH + 1;
check('a class of 26 fits on one sheet, and is not scaled to get there',
  small.zoom === '' && onPage(small),
  'zoom "' + small.zoom + '", row padding ' + small.rowpad);
check('a class of 40 fits too, still at full type size',
  mid.zoom === '' && onPage(mid),
  'zoom "' + mid.zoom + '", row padding ' + mid.rowpad + ', leading ' + mid.rowlh);
check('each gives up only as much row spacing as it has to',
  parseFloat(small.rowpad) > parseFloat(mid.rowpad) && parseFloat(small.rowpad) < 5,
  '26 names at ' + small.rowpad + ', 40 names at ' + mid.rowpad);
check('a class too long for any of that is scaled, down to a readable floor',
  big.rowpad === '1px' && parseFloat(big.rowlh) < 1.2 && parseFloat(big.zoom) === 0.65,
  'row padding ' + big.rowpad + ', leading ' + big.rowlh + ', zoom ' + big.zoom);

// the on-screen namelist is untouched: one Note column, no blank rows
const screen = await page.evaluate(() => {
  const S = window.NamelistSchema;
  const m = window.__testModel();
  const esc = (v) => String(v);
  const html = S.namelistHtml(m.groups[0],
    m.memberships.filter((x) => x.groupCode === 'SMALL')
      .map((x) => m.students.find((s) => s.id === x.studentId)), esc, {});
  const d = document.createElement('div');
  d.innerHTML = html;
  return { notes: d.querySelectorAll('.nl-note').length,
    boxes: d.querySelectorAll('.nl-box').length,
    blanks: d.querySelectorAll('.nl-blank').length };
});
check('on screen the namelist still reads as one Note column, with no spare lines',
  screen.notes === 26 && screen.boxes === 0 && screen.blanks === 0,
  JSON.stringify(screen));

check('no JS errors', errors.length === 0, errors.slice(0, 2).join('|'));
await browser.close();
console.log(failures.length ? 'FAILURES: ' + failures.length : 'All print-namelist checks passed');
process.exit(failures.length ? 1 : 0);
