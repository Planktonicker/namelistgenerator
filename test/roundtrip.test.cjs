#!/usr/bin/env node
/* Round-trip, import, and validation tests for the shared schema module.
 * Run: node test/roundtrip.test.cjs */
'use strict';
const assert = require('node:assert');

globalThis.XLSX = require('../vendor/xlsx.full.min.js');
require('../src/shared/schema.js');
const S = globalThis.NamelistSchema;
const { buildSampleModel } = require('../tools/gen-sample.cjs');
const XLSX = globalThis.XLSX;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

test('sample model is clean', () => {
  const model = buildSampleModel();
  assert.ok(model.students.length >= 100, 'expected 100+ students');
  assert.deepStrictEqual(S.validateModel(model), []);
});

test('model -> xlsx -> model round-trips exactly', () => {
  const model = buildSampleModel();
  const bytes = XLSX.write(S.modelToWorkbook(model), { bookType: 'xlsx', type: 'array' });
  const back = S.workbookToModel(XLSX.read(bytes, { type: 'array' }));
  assert.deepStrictEqual(back.warnings, []);
  assert.deepStrictEqual(back.model, model);
});

test('data.js output evaluates and matches the model', () => {
  const model = buildSampleModel();
  const code = S.modelToDataJs(model, '2026-01-01T00:00:00.000Z');
  const win = {};
  new Function('window', code)(win);
  assert.strictEqual(win.NAMELIST_DATA.savedAt, '2026-01-01T00:00:00.000Z');
  assert.deepStrictEqual(win.NAMELIST_DATA.students, model.students);
  assert.deepStrictEqual(win.NAMELIST_DATA.groups, model.groups);
  assert.deepStrictEqual(win.NAMELIST_DATA.memberships, model.memberships);
});

test('header aliases, subject columns, and messy input are tolerated', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Student ID', 'Full Name', 'Form Class', 'Sex', 'Posting Group', 'EL', 'MT'],
    [' s001 ', '  Alice Tan ', '1R1', 'F', '3', 'EL G3', 'CL G2'],
    ['', '', '', '', '', '', ''],                      // blank row: skipped silently
    ['s002', 'Bob Lim', '1R2', 'M', '2', 'EL G2', ''], // empty subject cell: key omitted
    ['', 'No Id Here', '1R3', 'M', '1', '', ''],       // missing ID: skipped with warning
  ]), 'students');                                     // lowercase sheet name still matches
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GroupCode', 'GroupName', 'Subject', 'Teacher']]), 'Groups');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['StudentID', 'GroupCode']]), 'Memberships');

  const { model, warnings } = S.workbookToModel(wb);
  assert.strictEqual(model.students.length, 2);
  assert.deepStrictEqual(model.subjectKeys, ['EL', 'MT']);
  assert.deepStrictEqual(model.students[0],
    { id: 's001', name: 'Alice Tan', class: '1R1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3', MT: 'CL G2' } });
  assert.deepStrictEqual(model.students[1].subjects, { EL: 'EL G2' });
  assert.ok(warnings.some((w) => w.includes('row 5')), 'expected a skipped-row warning');
});

test('detectHeaderRow skips titles and junk above the real header', () => {
  const rows = [
    ['', '8/3/26', 'Update'],
    [],
    ['No', 'Name', 'Class', 'Gender', 'PG', 'TG', 'EL', 'MT'],
    ['1', 'SEC1_1', '1R1', 'F', '3', 'TG1', 'EL G3', 'CL G3'],
  ];
  assert.strictEqual(S.detectHeaderRow(rows), 2);
  assert.strictEqual(S.detectHeaderRow([['Name', 'Class'], ['A', '1R1']]), 0);
});

test('importStudents: auto-IDs, subject columns, skipped rows', () => {
  const rows = [
    ['Some title', '', '', '', '', '', '', ''],
    ['No', 'Name', 'Class', 'Gender', 'PG', 'TG', 'EL', 'MT'],
    ['1', 'Alice', '1R1', 'F', '3', 'TG1', 'EL G3', 'CL G2'],
    ['2', 'Bob', '1R1', 'M', '2', 'TG2', 'EL G2', ''],
    ['3', '', '1R1', 'M', '', '', '', ''],          // no name: skipped
    ['1', 'Carol', '1R2', 'F', '1', 'TG1', 'EL G1', 'ML G1'],
  ];
  const res = S.importStudents(rows, {
    headerRow: 1,
    cols: { id: null, name: 1, class: 2, gender: 3, pg: 4 },
    subjectCols: [{ index: 5, header: 'TG' }, { index: 6, header: 'EL' }, { index: 7, header: 'MT' }],
  });
  assert.strictEqual(res.students.length, 3);
  assert.deepStrictEqual(res.students.map((s) => s.id), ['1R1-01', '1R1-02', '1R2-01']);
  assert.deepStrictEqual(res.students[0].subjects, { TG: 'TG1', EL: 'EL G3', MT: 'CL G2' });
  assert.deepStrictEqual(res.students[1].subjects, { TG: 'TG2', EL: 'EL G2' }); // empty cell omitted
  assert.deepStrictEqual(res.students[2],
    { id: '1R2-01', name: 'Carol', class: '1R2', gender: 'F', pg: '1', origin: 'file', subjects: { TG: 'TG1', EL: 'EL G1', MT: 'ML G1' } });
  assert.strictEqual(res.warnings.length, 1);
  assert.ok(res.warnings[0].includes('no name'));
});

test('importStudents: explicit ID column and duplicate IDs', () => {
  const rows = [
    ['StudentID', 'Name'],
    ['S1', 'Alice'],
    ['S1', 'Alice Again'],   // duplicate: skipped with warning
    ['S2', 'Bob'],
  ];
  const res = S.importStudents(rows, { headerRow: 0, cols: { id: 0, name: 1 }, subjectCols: [] });
  assert.deepStrictEqual(res.students.map((s) => s.id), ['S1', 'S2']);
  assert.ok(res.warnings[0].includes('duplicate ID'));
});

test('subjectSummary shows the key only when the value needs it', () => {
  const student = { subjects: { EL: 'EL G3', MT: 'CL G2', HMT: 'CHINESE' } };
  assert.strictEqual(S.subjectSummary(student, ['EL', 'MT', 'HMT']),
    'EL G3 · MT CL G2 · HMT CHINESE');
  assert.ok(S.studentSearchText({ name: 'A', class: '1R1', id: 'x', pg: '3', subjects: student.subjects },
    ['EL', 'MT', 'HMT']).includes('mt cl g2'));
});

test('applyLevelUpdate matches by name, keeps IDs and memberships, scopes columns', () => {
  const model = {
    students: [
      { id: '1R1-01', name: 'Alice Tan', class: '1R1', gender: 'F', pg: '3', subjects: { EL: 'EL G3', MT: 'CL G3' } },
      { id: '1R1-02', name: 'Bob Lim', class: '1R1', gender: 'M', pg: '2', subjects: { EL: 'EL G2', MT: 'ML G2' } },
      { id: '2R1-01', name: 'Sec Two Kid', class: '2R1', gender: 'M', pg: '1', subjects: { EL: 'EL G1' } },
    ],
    groups: [{ code: 'G1', name: 'G', subject: 'X', teacher: 'T' }],
    memberships: [
      { studentId: '1R1-01', groupCode: 'G1' },
      { studentId: '2R1-01', groupCode: 'G1' },
    ],
    subjectKeys: ['EL', 'MT'],
    sources: [],
  };
  // New file: Alice's EL band changed, Bob missing, one new student.
  // File has EL and GEOG columns but no MT column.
  const imported = [
    { id: '1R1-01', name: 'ALICE TAN', class: '1R1', gender: 'F', pg: '3', subjects: { EL: 'EL G1', GEOG: 'GEOG G1' } },
    { id: '1R1-02', name: 'New Person', class: '1R1', gender: 'M', pg: '2', subjects: { EL: 'EL G2' } },
  ];
  const report = S.applyLevelUpdate(model, imported, ['EL', 'GEOG']);
  assert.deepStrictEqual(report.classes, ['1R1']);
  assert.strictEqual(report.updated, 1);
  assert.strictEqual(report.added, 1);
  assert.deepStrictEqual(report.missingIds, ['1R1-02']);   // Bob

  const alice = model.students.find((s) => s.id === '1R1-01');
  assert.strictEqual(alice.name, 'ALICE TAN');             // takes the file's casing
  assert.deepStrictEqual(alice.subjects, { EL: 'EL G1', MT: 'CL G3', GEOG: 'GEOG G1' }); // MT untouched
  // new student got a free ID, not Bob's
  const newKid = model.students.find((s) => s.name === 'New Person');
  assert.strictEqual(newKid.id, '1R1-03');
  // untouched level and memberships intact
  assert.ok(model.students.some((s) => s.id === '2R1-01'));
  assert.strictEqual(model.memberships.length, 2);
  assert.deepStrictEqual(model.subjectKeys, ['EL', 'MT', 'GEOG']);
});

test('students added in the app survive level updates and are adopted on match', () => {
  const model = {
    students: [
      { id: '1R1-01', name: 'From File', class: '1R1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3' } },
      { id: '1R1-27', name: 'Late Transfer', class: '1R1', gender: 'M', pg: '2', origin: 'added', subjects: { EL: 'EL G2' } },
      { id: '1R1-28', name: 'Also Added', class: '1R1', gender: 'F', pg: '1', origin: 'added', subjects: { EL: 'EL G1' } },
    ],
    groups: [{ code: 'G1', name: 'G', subject: 'X', teacher: 'T' }],
    memberships: [{ studentId: '1R1-27', groupCode: 'G1' }],
    subjectKeys: ['EL'],
    sources: [],
  };
  // The school's file lists only the original student, plus (finally) one of
  // the added ones. Neither added student may be proposed for removal.
  const imported = [
    { id: 'x', name: 'From File', class: '1R1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3' } },
    { id: 'y', name: 'Late Transfer', class: '1R1', gender: 'M', pg: '2', origin: 'file', subjects: { EL: 'EL G1' } },
  ];
  const report = S.applyLevelUpdate(model, imported, ['EL']);
  assert.strictEqual(report.updated, 2);
  assert.strictEqual(report.added, 0);
  assert.deepStrictEqual(report.missingIds, []);            // nothing offered for deletion
  assert.deepStrictEqual(report.keptAddedIds, ['1R1-28']);  // still app-owned, untouched

  const adopted = model.students.find((s) => s.name === 'Late Transfer');
  assert.strictEqual(adopted.id, '1R1-27');                 // same id, so...
  assert.strictEqual(model.memberships.length, 1);          // ...group membership kept
  assert.strictEqual(adopted.origin, 'file');               // adopted by the school's file
  assert.strictEqual(adopted.subjects.EL, 'EL G1');         // and refreshed from it
  assert.strictEqual(model.students.length, 3);             // no duplicate created
  assert.strictEqual(model.students.find((s) => s.name === 'Also Added').origin, 'added');
});

test('nextFreeId continues a class register without clashing', () => {
  const model = {
    students: [
      { id: '1R1-01', name: 'A', class: '1R1' },
      { id: '1R1-02', name: 'B', class: '1R1' },
    ],
  };
  assert.strictEqual(S.nextFreeId(model, '1R1'), '1R1-03');
  assert.strictEqual(S.nextFreeId(model, '1R2'), '1R2-01');
  assert.strictEqual(S.nextFreeId(model, ''), 'S-01');
});

test('findNewestMatch picks the latest matching file and skips lock files', () => {
  const files = [
    { name: 'Sec 1 Subject Allocation_14 Jan.xlsx', lastModified: 100 },
    { name: 'Sec 1 Subject Allocation_21 July.xlsx', lastModified: 900 },
    { name: '~$Sec 1 Subject Allocation_21 July.xlsx', lastModified: 999 },
    { name: 'Sec 2 Subject Allocation_13Jan.xlsx', lastModified: 500 },
  ];
  assert.strictEqual(S.findNewestMatch(files, 'Sec 1 Subject Allocation').name,
    'Sec 1 Subject Allocation_21 July.xlsx');
  assert.strictEqual(S.findNewestMatch(files, 'sec 2 subject').name,
    'Sec 2 Subject Allocation_13Jan.xlsx');
  assert.strictEqual(S.findNewestMatch(files, 'Sec 3'), null);
});

test('auto-fill rules match bands and class prefixes, never remove, respect onlyIds', () => {
  const model = {
    students: [
      { id: '1R1-01', name: 'A', class: '1R1', gender: 'F', pg: '3', subjects: { EL: 'EL G3', HMT: 'CHINESE' } },
      { id: '1R2-01', name: 'B', class: '1R2', gender: 'M', pg: '3', subjects: { EL: 'el g3' } },  // case-insensitive value
      { id: '1R2-02', name: 'C', class: '1R2', gender: 'M', pg: '2', subjects: { EL: 'EL G2' } },
      { id: '2R1-01', name: 'D', class: '2R1', gender: 'F', pg: '3', subjects: { EL: 'EL G3' } },
    ],
    groups: [
      { code: 'ELG3-S1', name: '', subject: '', teacher: '', autoKey: 'EL', autoValue: 'EL G3', autoClasses: '1R' },
      { code: 'HMT-ALL', name: '', subject: '', teacher: '', autoKey: 'HMT', autoValue: '', autoClasses: '' },
      { code: 'MANUAL', name: '', subject: '', teacher: '', autoKey: '', autoValue: '', autoClasses: '' },
    ],
    memberships: [],
    subjectKeys: ['EL', 'HMT'],
    sources: [],
  };
  const g = model.groups[0];
  assert.strictEqual(S.groupHasRule(g), true);
  assert.strictEqual(S.groupHasRule(model.groups[2]), false);

  // EL G3 in Sec 1 classes only: A and B (case-insensitive), not C (G2), not D (2R1)
  assert.strictEqual(S.autoFillGroup(model, g), 2);
  assert.deepStrictEqual(model.memberships.map((m) => m.studentId + '/' + m.groupCode).sort(),
    ['1R1-01/ELG3-S1', '1R2-01/ELG3-S1']);
  // re-run adds nothing (and never removes)
  model.memberships = model.memberships.filter((m) => m.studentId !== '1R2-01'); // manual removal
  assert.strictEqual(S.autoFillGroup(model, g, ['1R1-01']), 0);  // onlyIds: removed student not revisited
  assert.strictEqual(model.memberships.length, 1);
  // any-value rule: everyone with something in HMT
  assert.strictEqual(S.autoFillGroup(model, model.groups[1]), 1);
  // rule-less group never auto-fills
  assert.strictEqual(S.autoFillGroup(model, model.groups[2]), 0);
});

test('validation flags duplicates and dangling memberships', () => {
  const model = {
    students: [
      { id: 'S1', name: 'A', class: '1R1', gender: 'F', pg: '3', subjects: {} },
      { id: 'S1', name: 'B', class: '1R2', gender: 'M', pg: '2', subjects: {} },
    ],
    groups: [{ code: 'G1', name: 'G', subject: 'X', teacher: '' }],
    memberships: [
      { studentId: 'S1', groupCode: 'G1' },
      { studentId: 'S1', groupCode: 'G1' },
      { studentId: 'NOPE', groupCode: 'MISSING' },
    ],
  };
  const warnings = S.validateModel(model);
  assert.ok(warnings.some((w) => w.includes('Duplicate StudentID')));
  assert.ok(warnings.some((w) => w.includes('no teacher')));
  assert.ok(warnings.some((w) => w.includes('Duplicate membership')));
  assert.ok(warnings.some((w) => w.includes('unknown StudentID')));
  assert.ok(warnings.some((w) => w.includes('unknown GroupCode')));
});

test('indexes wire teachers, groups and members together', () => {
  const model = buildSampleModel();
  const ix = S.buildIndexes(model);
  assert.ok(ix.teachers.includes('Mrs Lim Bee Leng'));
  const groups = ix.groupsByTeacher.get('Mrs Lim Bee Leng');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].code, 'EL-1R1');
  const members = ix.membersByGroup.get('EL-1R1');
  assert.strictEqual(members.length, 26);
  const sorted = members.slice().sort(S.byClassThenName);
  assert.deepStrictEqual(members, sorted);
});

test('missing sheets produce warnings, not crashes', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Unrelated');
  const { model, warnings } = S.workbookToModel(wb);
  assert.deepStrictEqual(model, S.emptyModel());
  assert.strictEqual(warnings.filter((w) => w.includes('not found')).length, 3);
});

console.log(passed + ' tests passed');
