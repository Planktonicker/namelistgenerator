#!/usr/bin/env node
/* A synthetic "school allocation workbook" — the shape the office sends, not
 * the shape this app saves.
 *
 * Two suites (setup-flow, auto-update) drive the first-run walkthrough and the
 * per-level refresh, and both need such a file. They used to skip unless
 * ALLOCATION_XLSX pointed at a real one, which meant the setup screen went
 * untested on every run. This makes one from the sample roll so they run by
 * default. Point ALLOCATION_XLSX at a real workbook to test against that
 * instead — it takes precedence.
 *
 *   node tools/gen-school-file.cjs
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
globalThis.XLSX = require('../vendor/xlsx.full.min.js');
require('../src/shared/schema.js');
const S = globalThis.NamelistSchema;
const XLSX = globalThis.XLSX;
const { buildSampleModel } = require('./gen-sample.cjs');

function schoolSheet(model) {
  const keys = model.subjectKeys || [];
  /* The office's own headings, in the office's own order, with a title row and
   * a blank line above the header — exactly the mess the importer is built to
   * find its way through. */
  const rows = [
    ['SUBJECT GROUPING LIST 2026'],
    [],
    ['S/N', 'Name', 'Class', 'Level', 'Gender', 'PG', 'SG'].concat(keys),
  ];
  model.students.forEach((s, i) => {
    rows.push([
      i + 1, s.name, s.class, s.level, s.gender, s.pg, s.tg,
    ].concat(keys.map((k) => (s.subjects && s.subjects[k]) || '')));
  });
  return XLSX.utils.aoa_to_sheet(rows);
}

function build() {
  const model = buildSampleModel();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, schoolSheet(model), 'Sec 1');
  return wb;
}

module.exports = { build };

if (require.main === module) {
  const out = path.join(__dirname, '..', 'sample', 'school');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'Sec 1 Subject Grouping List.xlsx');
  fs.writeFileSync(file, XLSX.write(build(), { bookType: 'xlsx', type: 'buffer' }));
  const n = buildSampleModel().students.length;
  console.log('sample/school/: ' + n + ' students in the office’s column shape');
}
