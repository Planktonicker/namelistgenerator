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
    ['Student ID', 'Full Name', 'Form Class', 'Level', 'Sex', 'Posting Group', 'EL', 'MT'],
    [' s001 ', '  Alice Tan ', '1R1', '1', 'F', '3', 'EL G3', 'CL G2'],
    ['', '', '', '', '', '', '', ''],                        // blank row: skipped silently
    ['s002', 'Bob Lim', '1R2', '1', 'M', '2', 'EL G2', ''],  // empty subject cell: key omitted
    ['', 'No Id Here', '1R3', '1', 'M', '1', '', ''],        // missing ID: skipped with warning
  ]), 'students');                                     // lowercase sheet name still matches
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['GroupCode', 'GroupName', 'Subject', 'Teacher']]), 'Groups');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['StudentID', 'GroupCode']]), 'Memberships');

  const { model, warnings } = S.workbookToModel(wb);
  assert.strictEqual(model.students.length, 2);
  assert.deepStrictEqual(model.subjectKeys, ['EL', 'MT']);
  assert.deepStrictEqual(model.students[0],
    { id: 's001', name: 'Alice Tan', class: '1R1', level: '1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3', MT: 'CL G2' } });
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
    cols: { id: null, name: 1, class: 2, gender: 3, pg: 4, level: null },
    subjectCols: [{ index: 5, header: 'TG' }, { index: 6, header: 'EL' }, { index: 7, header: 'MT' }],
  });
  assert.strictEqual(res.students.length, 3);
  assert.deepStrictEqual(res.students.map((s) => s.id), ['1R1-01', '1R1-02', '1R2-01']);
  assert.deepStrictEqual(res.students[0].subjects, { TG: 'TG1', EL: 'EL G3', MT: 'CL G2' });
  assert.deepStrictEqual(res.students[1].subjects, { TG: 'TG2', EL: 'EL G2' }); // empty cell omitted
  assert.deepStrictEqual(res.students[2],
    { id: '1R2-01', name: 'Carol', class: '1R2', level: '', gender: 'F', pg: '1', origin: 'file', subjects: { TG: 'TG1', EL: 'EL G1', MT: 'ML G1' } });
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
    groups: [{ code: 'G1', name: 'G', subject: 'X', teachers: ['T'] }],
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
      { id: '1R1-01', name: 'From File', class: '1R1', level: '1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3' } },
      { id: '1R1-27', name: 'Late Transfer', class: '1R1', level: '1', gender: 'M', pg: '2', origin: 'added', subjects: { EL: 'EL G2' } },
      { id: '1R1-28', name: 'Also Added', class: '1R1', level: '1', gender: 'F', pg: '1', origin: 'added', subjects: { EL: 'EL G1' } },
    ],
    groups: [{ code: 'G1', name: 'G', subject: 'X', teachers: ['T'] }],
    memberships: [{ studentId: '1R1-27', groupCode: 'G1' }],
    subjectKeys: ['EL'],
    sources: [],
  };
  // The school's file lists only the original student, plus (finally) one of
  // the added ones. Neither added student may be proposed for removal.
  const imported = [
    { id: 'x', name: 'From File', class: '1R1', level: '1', gender: 'F', pg: '3', origin: 'file', subjects: { EL: 'EL G3' } },
    { id: 'y', name: 'Late Transfer', class: '1R1', level: '1', gender: 'M', pg: '2', origin: 'file', subjects: { EL: 'EL G1' } },
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

test('derivePattern keeps the stable part of real school filenames', () => {
  const cases = [
    ['Sec 1 Subject Allocation_14 Jan.xlsx', 'Sec 1 Subject Allocation'],
    ['Sec 2 Subject Allocation_13Jan.xlsx', 'Sec 2 Subject Allocation'],
    ['2026_Sec 4_Final Classlist (updated 21 July).xlsx', '2026_Sec 4_Final Classlist'],
    ['2026_Sec 4_Final Classlist (updated 1 July).xlsx', '2026_Sec 4_Final Classlist'],
    ['Sec 3 Subject Grouping List.xlsx', 'Sec 3 Subject Grouping List'],
    ['2026_Sec 5N Subject Combi.xlsx', '2026_Sec 5N Subject Combi'],  // trailing text kept
    ['Class list 2026.xlsx', 'Class list 2026'],                      // bare year NOT stripped
  ];
  cases.forEach(([input, expected]) => {
    assert.strictEqual(S.derivePattern(input), expected, input);
  });
});

test('resolveSource reports up-to-date, stale, renamed, and missing files', () => {
  const files = [
    { name: 'Sec 1 Subject Allocation_14 Jan.xlsx', lastModified: 1000 },
    { name: 'Sec 2 Subject Allocation_13Jan.xlsx', lastModified: 1000 },
    { name: '~$Sec 1 Subject Allocation_14 Jan.xlsx', lastModified: 9999 },
  ];
  // never imported -> stale (there is something to import)
  let r = S.resolveSource(files, { level: 'Sec 1', file: 'Sec 1 Subject Allocation_14 Jan.xlsx', pattern: '', lastImported: '' });
  assert.strictEqual(r.status, 'stale');
  assert.strictEqual(r.file.name, 'Sec 1 Subject Allocation_14 Jan.xlsx');

  // imported after the file's timestamp -> current
  r = S.resolveSource(files, {
    level: 'Sec 1', file: 'Sec 1 Subject Allocation_14 Jan.xlsx', pattern: '',
    lastImported: new Date(5000).toISOString(),
  });
  assert.strictEqual(r.status, 'current');

  // the office saves a newer file under a new name -> offered as a switch,
  // never applied silently
  const renamed = files.concat([{ name: 'Sec 1 Subject Allocation_5 Aug.xlsx', lastModified: 8000 }]);
  r = S.resolveSource(renamed, {
    level: 'Sec 1', file: 'Sec 1 Subject Allocation_14 Jan.xlsx', pattern: '',
    lastImported: new Date(5000).toISOString(),
  });
  assert.strictEqual(r.status, 'renamed');
  assert.strictEqual(r.alt.name, 'Sec 1 Subject Allocation_5 Aug.xlsx');
  assert.strictEqual(r.file.name, 'Sec 1 Subject Allocation_14 Jan.xlsx');

  // chosen file deleted, a similar one remains
  r = S.resolveSource(renamed, {
    level: 'Sec 1', file: 'Sec 1 Subject Allocation_OLD.xlsx', pattern: 'Sec 1 Subject Allocation',
    lastImported: new Date(5000).toISOString(),
  });
  assert.strictEqual(r.status, 'missing-alt');
  assert.strictEqual(r.alt.name, 'Sec 1 Subject Allocation_5 Aug.xlsx');

  // nothing resembling it
  r = S.resolveSource(files, { level: 'Sec 5', file: 'Sec 5 Combi.xlsx', pattern: '', lastImported: '' });
  assert.strictEqual(r.status, 'missing');

  // no file chosen yet
  r = S.resolveSource(files, { level: 'Sec 5', file: '', pattern: '', lastImported: '' });
  assert.strictEqual(r.status, 'none');

  // a source saved before explicit file choice existed still resolves by pattern
  r = S.resolveSource(files, { level: 'Sec 2', file: '', pattern: 'Sec 2 Subject Allocation', lastImported: '' });
  assert.strictEqual(r.status, 'stale');
  assert.strictEqual(r.file.name, 'Sec 2 Subject Allocation_13Jan.xlsx');

  // an arbitrary name works fine — it is just an exact match
  const odd = [{ name: 'whatever the office called it.xlsx', lastModified: 700 }];
  r = S.resolveSource(odd, { level: 'Sec 3', file: 'whatever the office called it.xlsx', pattern: '', lastImported: '' });
  assert.strictEqual(r.status, 'stale');
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
      { id: '1R1-01', name: 'A', class: '1R1', level: '1', gender: 'F', pg: '3', subjects: { EL: 'EL G3', HMT: 'CHINESE' } },
      { id: '1R2-01', name: 'B', class: '1R2', level: '1', gender: 'M', pg: '3', subjects: { EL: 'el g3' } },  // case-insensitive value
      { id: '1R2-02', name: 'C', class: '1R2', level: '1', gender: 'M', pg: '2', subjects: { EL: 'EL G2' } },
      { id: '2R1-01', name: 'D', class: '2R1', level: '2', gender: 'F', pg: '3', subjects: { EL: 'EL G3' } },
    ],
    groups: [
      { code: 'ELG3-S1', name: '', subject: '', teachers: [], level: '', autoMatch: 'EL=EL G3', autoLevel: '', autoPg: '', autoClasses: '1R' },
      { code: 'HMT-ALL', name: '', subject: '', teachers: [], level: '', autoMatch: 'HMT=', autoLevel: '', autoPg: '', autoClasses: '' },
      { code: 'MANUAL', name: '', subject: '', teachers: [], level: '', autoMatch: '', autoLevel: '', autoPg: '', autoClasses: '' },
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

test('a class can be shared by several teachers', () => {
  const model = {
    students: [{ id: 'S1', name: 'A', class: '3S1', level: '3', gender: 'M', pg: 'PG3', subjects: { SG: '3 A' } }],
    groups: [{
      code: 'G1', name: 'Hist 3 A', subject: 'Hist',
      teachers: ['Teacher 1', 'Teacher 2'], level: '3',
      autoMatch: 'SG=3 A', autoLevel: '3', autoPg: '', autoClasses: '',
    }],
    memberships: [{ studentId: 'S1', groupCode: 'G1' }],
    subjectKeys: ['SG'],
    sources: [],
  };
  const ix = S.buildIndexes(model);
  assert.deepStrictEqual(ix.teachers, ['Teacher 1', 'Teacher 2']);
  assert.strictEqual(ix.groupsByTeacher.get('Teacher 1')[0].code, 'G1');
  assert.strictEqual(ix.groupsByTeacher.get('Teacher 2')[0].code, 'G1');

  // teachers survive the xlsx round-trip as a list
  const back = S.workbookToModel(XLSX.read(
    XLSX.write(S.modelToWorkbook(model), { bookType: 'xlsx', type: 'array' }), { type: 'array' }));
  assert.deepStrictEqual(back.model.groups[0].teachers, ['Teacher 1', 'Teacher 2']);
  assert.strictEqual(back.model.groups[0].level, '3');
  // a legacy single "Teacher" column still reads
  assert.deepStrictEqual(S.parseTeachers('Solo Teacher'), ['Solo Teacher']);
});

test('rules key on Level + PG + group value, like the setup grid', () => {
  const mk = (id, level, pg, sg, cls) =>
    ({ id, name: id, class: cls, level, gender: 'M', pg, subjects: { SG: sg } });
  const model = {
    students: [
      mk('a', '3', 'PG3', '3 A', '3S1'),
      mk('b', '3', 'PG3', '3 A', '3S2'),
      mk('c', '3', 'PG2', '3 A', '3S1'),   // wrong PG
      mk('d', '4', 'PG3', '3 A', '4E1'),   // wrong level
      mk('e', '3', 'PG3', '3 B', '3S1'),   // wrong group
    ],
    groups: [{
      code: 'H3A', name: 'Hist 3 A', subject: 'Hist', teachers: ['T1'], level: '3',
      autoMatch: 'SG=3 A', autoLevel: '3', autoPg: 'PG3', autoClasses: '',
    }],
    memberships: [],
    subjectKeys: ['SG'],
    sources: [],
  };
  assert.strictEqual(S.autoFillGroup(model, model.groups[0]), 2);
  assert.deepStrictEqual(model.memberships.map((m) => m.studentId), ['a', 'b']);

  // a level-only rule takes the whole cohort
  model.groups.push({
    code: 'L3', name: 'All Sec 3', subject: '', teachers: ['T2'], level: '3',
    autoMatch: '', autoLevel: '3', autoPg: '', autoClasses: '',
  });
  assert.strictEqual(S.autoFillGroup(model, model.groups[1]), 4);
});

test('a teacher\'s classes are bucketed by level, in level order', () => {
  const g = (code, level, teachers) =>
    ({ code, name: code, subject: 'X', teachers, level, autoMatch: '', autoLevel: '', autoPg: '', autoClasses: '' });
  const model = {
    students: [
      { id: 's3', name: 'Three', class: '3S1', level: '3', gender: 'M', pg: '', subjects: {} },
      { id: 's4', name: 'Four', class: '4E1', level: '4', gender: 'M', pg: '', subjects: {} },
    ],
    groups: [g('B', '4', ['Mrs Wong']), g('A', '3', ['Mrs Wong']), g('C', '', ['Mrs Wong'])],
    memberships: [
      { studentId: 's4', groupCode: 'B' },
      { studentId: 's3', groupCode: 'A' },
      { studentId: 's3', groupCode: 'C' },
    ],
    subjectKeys: [],
    sources: [],
  };
  const ix = S.buildIndexes(model);
  const buckets = S.groupsByLevelFor(ix, 'Mrs Wong');
  // C has no level of its own, so it follows its members (Sec 3)
  assert.deepStrictEqual(buckets.map((b) => b.level), ['3', '4']);
  assert.deepStrictEqual(buckets[0].groups.map((x) => x.code).sort(), ['A', 'C']);
  assert.deepStrictEqual(buckets[1].groups.map((x) => x.code), ['B']);
  // a group with neither level nor members files under "" and sorts last
  assert.strictEqual(S.groupLevel({ level: '' }, []), '');
});

test('validation flags duplicates and dangling memberships', () => {
  const model = {
    students: [
      { id: 'S1', name: 'A', class: '1R1', level: '1', gender: 'F', pg: '3', subjects: {} },
      { id: 'S1', name: 'B', class: '1R2', level: '1', gender: 'M', pg: '2', subjects: {} },
    ],
    groups: [{ code: 'G1', name: 'G', subject: 'X', teachers: [] }],
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
