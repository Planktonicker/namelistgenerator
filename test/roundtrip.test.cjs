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
    { id: 's001', name: 'Alice Tan', class: '1R1', level: '1', gender: 'F', pg: '3', tg: '', sn: '',
      origin: 'file', sourceName: 'Alice Tan', status: '',
      subjects: { EL: 'EL G3', MT: 'CL G2' } });
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
    cols: { id: null, name: 1, class: 2, gender: 3, pg: 4, tg: 5, level: null },
    subjectCols: [{ index: 6, header: 'EL' }, { index: 7, header: 'MT' }],
  });
  assert.strictEqual(res.students.length, 3);
  assert.deepStrictEqual(res.students.map((s) => s.id), ['1R1-01', '1R1-02', '1R2-01']);
  // the tutorial/subject group is a field of its own, not a subject column
  assert.deepStrictEqual(res.students.map((s) => s.tg), ['TG1', 'TG2', 'TG1']);
  assert.deepStrictEqual(res.students[0].subjects, { EL: 'EL G3', MT: 'CL G2' });
  assert.deepStrictEqual(res.students[1].subjects, { EL: 'EL G2' }); // empty cell omitted
  assert.deepStrictEqual(res.students[2],
    { id: '1R2-01', name: 'Carol', class: '1R2', level: '', gender: 'F', pg: '1', tg: 'TG1', sn: '',
      origin: 'file', sourceName: 'Carol', subjects: { EL: 'EL G1', MT: 'ML G1' } });
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

test('a name edited here survives later imports and still matches', () => {
  const stu = (id, name, sourceName) =>
    ({ id, name, class: '1R1', level: '1', gender: '', pg: '', origin: 'file', sourceName, subjects: {} });
  const model = {
    students: [stu('1R1-01', 'Nur Aisyah Binte Rahman', 'Nur Aisyah Bte Rahman')],
    groups: [{ code: 'G', name: 'G', subject: '', teachers: ['T'], level: '', autoMatch: '', autoPg: '', autoClasses: '' }],
    memberships: [{ studentId: '1R1-01', groupCode: 'G' }],
    subjectKeys: [], sources: [],
  };
  // the file still spells it the old way: must match, must not overwrite
  const r = S.applyLevelUpdate(model, [stu('x', 'Nur Aisyah Bte Rahman', 'Nur Aisyah Bte Rahman')], []);
  assert.strictEqual(model.students.length, 1);
  assert.strictEqual(r.added, 0);
  assert.deepStrictEqual(r.missingIds, []);
  assert.strictEqual(model.students[0].name, 'Nur Aisyah Binte Rahman');   // the admin's correction stands
  assert.strictEqual(model.students[0].sourceName, 'Nur Aisyah Bte Rahman');
  assert.strictEqual(model.memberships.length, 1);

  // a student whose name was never edited still follows the file
  const plain = {
    students: [stu('1R1-02', 'Bob Lim', 'Bob Lim')],
    groups: [], memberships: [], subjectKeys: [], sources: [],
  };
  S.applyLevelUpdate(plain, [stu('y', 'Bob Lim', 'Bob Lim')], []);
  assert.strictEqual(plain.students.length, 1);

  /* The office renaming somebody nobody edited is genuinely ambiguous — it
   * could be a rewrite or a different person — so it is reported rather than
   * guessed, and Merge settles it. */
  const renamed = {
    students: [stu('1R1-03', 'Nur Aisyah', 'Nur Aisyah')],
    groups: [], memberships: [], subjectKeys: [], sources: [],
  };
  S.applyLevelUpdate(renamed, [stu('z', 'Nur Aisyah Bte Rahman', 'Nur Aisyah Bte Rahman')], []);
  assert.strictEqual(renamed.students.length, 2);
  assert.ok(S.validateModel(renamed).some((w) => w.includes('Possible duplicate')),
    'the pair should be flagged for merging');
  const merged = S.mergeStudents(renamed, '1R1-03', renamed.students[1].id);
  assert.ok(merged);
  assert.strictEqual(renamed.students.length, 1);
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

test('posting groups are always 1, 2, 3 — however the file writes them', () => {
  assert.strictEqual(S.normPg('PG1'), '1');
  assert.strictEqual(S.normPg('pg 2'), '2');
  assert.strictEqual(S.normPg('P.G.3'), '3');
  assert.strictEqual(S.normPg('3'), '3');
  assert.strictEqual(S.normPg(''), '');
  assert.strictEqual(S.normPg('N/A'), 'N/A');   // not a posting group: left alone

  // a rule ticked as PG 3 still matches a student the file wrote as "PG3"
  const group = { code: 'G', autoPg: '3' };
  assert.ok(S.matchesRule({ pg: 'PG3', subjects: {} }, group));
  assert.ok(!S.matchesRule({ pg: '2', subjects: {} }, group));

  // and a workbook holding "PG2" reads back as "2"
  const model = S.emptyModel();
  model.students.push({ id: 'a', name: 'A', class: '1R1', level: '1', gender: 'F',
    pg: 'PG2', origin: 'file', sourceName: 'A', subjects: {} });
  model.groups.push({ code: 'G', name: 'G', subject: '', teachers: [], level: '',
    autoMatch: '', autoPg: 'PG2', autoClasses: '' });
  const back = S.workbookToModel(S.modelToWorkbook(model)).model;
  assert.strictEqual(back.students[0].pg, '2');
  assert.strictEqual(back.groups[0].autoPg, '2');
});

test('several groups ticked in one column mean either of them', () => {
  const group = { code: 'G', autoMatch: 'HIST=HIST G3|HIST G2; TG=TG2' };
  const ms = S.matchers(group);
  assert.deepStrictEqual(ms[0].values, ['HIST G3', 'HIST G2']);
  assert.strictEqual(S.matchersToString(ms), 'HIST=HIST G3|HIST G2; TG=TG2');
  const take = (hist, tg) => S.matchesRule({ subjects: { HIST: hist, TG: tg } }, group);
  assert.ok(take('HIST G3', 'TG2'));
  assert.ok(take('HIST G2', 'TG2'));      // the second tick
  assert.ok(!take('HIST G1', 'TG2'));     // not ticked
  assert.ok(!take('HIST G3', 'TG1'));     // other column still ANDs
  // a single-value rule written by an older build keeps working
  assert.ok(S.matchesRule({ subjects: { EL: 'EL G2' } }, { code: 'G', autoMatch: 'EL=EL G2' }));
});

test('columns that are not allocations are flagged, not made into classes', () => {
  const students = [
    { id: '1', name: 'A', class: '1R1', subjects: { HIST: 'HIST G3', Year: '2026', DT: 'N/A' } },
    { id: '2', name: 'B', class: '1R1', subjects: { HIST: 'HIST G3', Year: '2026' } },
  ];
  const found = S.discoverClasses(students, 'Sec 1');
  const good = found.filter((g) => !g.suspect);
  const bad = found.filter((g) => g.suspect);
  assert.deepStrictEqual(good.map((g) => g.autoMatch), ['HIST=HIST G3']);
  assert.strictEqual(bad.length, 2);
  assert.ok(bad.some((g) => /not a subject column/.test(g.why)));
  assert.ok(bad.some((g) => /placeholder/.test(g.why)));
  // a codeless allocation still gets a readable code
  const codeless = S.discoverClasses(
    [{ id: '1', name: 'A', class: '1R1', subjects: { 'Humanities (SS, Literature in English)': 'G3' } }], '');
  assert.strictEqual(codeless[0].code, 'HUMANITIES-G3');
});

test('TG/SG is a field of its own, and old files are lifted onto it', () => {
  // an older namelist.xlsx: the tutorial group is just another subject column
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['StudentID', 'Name', 'Class', 'Level', 'Gender', 'PG', 'Origin', 'SourceName', 'SG', 'HIST'],
    ['s1', 'Alice', '1R1', 'Sec 1', 'F', '3', 'file', '', 'SG 3', 'HIST G3'],
    ['s2', 'Bob', '1R2', 'Sec 1', 'M', '3', 'file', '', 'sg3', 'HIST G3'],
    ['s3', 'Cara', '1R3', 'Sec 1', 'F', '3', 'file', '', 'SG4', 'HIST G3'],
  ]), 'Students');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['GroupCode', 'GroupName', 'Subject', 'Teachers', 'Level', 'AutoMatch', 'AutoPG', 'AutoClasses'],
    ['H3', 'History SG3', 'HIST', 'Mrs Wong', 'Sec 1', 'HIST=HIST G3; SG=SG3', '', ''],
  ]), 'Groups');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['StudentID', 'GroupCode']]), 'Memberships');
  const { model } = S.workbookToModel(wb);

  // the column is gone from the subject list and lives on the student
  assert.deepStrictEqual(model.subjectKeys, ['HIST']);
  assert.deepStrictEqual(model.students.map((s) => s.tg), ['SG3', 'SG3', 'SG4']);
  assert.deepStrictEqual(model.students[0].subjects, { HIST: 'HIST G3' });

  // the rule that pointed at the column now points at the field
  assert.strictEqual(model.groups[0].autoMatch, 'HIST=HIST G3');
  assert.strictEqual(model.groups[0].autoTg, 'SG3');
  assert.strictEqual(S.autoFillGroup(model, model.groups[0]), 2);   // Alice + Bob, not Cara

  // a subject group spans form classes, which is the whole point
  const codes = model.memberships.map((m) => m.studentId);
  assert.deepStrictEqual(codes, ['s1', 's2']);

  // and it survives the next save/load
  const back = S.workbookToModel(S.modelToWorkbook(model)).model;
  assert.deepStrictEqual(back.students.map((s) => s.tg), ['SG3', 'SG3', 'SG4']);
  assert.strictEqual(back.groups[0].autoTg, 'SG3');
  assert.strictEqual(S.normTg('sg 3'), 'SG3');
  assert.strictEqual(S.normTg('TG-2'), 'TG2');
});

test('coverage: students taking a subject with no class for it', () => {
  const model = {
    students: [
      { id: 'a', name: 'A', class: '1R1', subjects: { EL: 'EL G3', HIST: 'HIST G3' } },
      { id: 'b', name: 'B', class: '1R1', subjects: { EL: 'EL G3', HIST: 'HIST G3' } },
      { id: 'c', name: 'C', class: '1R2', subjects: { EL: 'EL G2', GEOG: 'GEOG G2' } },
    ],
    groups: [
      { code: 'EL3', name: 'English G3', subject: 'EL', teachers: ['T'], autoMatch: 'EL=EL G3' },
      { code: 'H3', name: 'History G3', subject: 'HIST', teachers: ['T'], autoMatch: 'HIST=HIST G3' },
    ],
    memberships: [
      { studentId: 'a', groupCode: 'EL3' }, { studentId: 'b', groupCode: 'EL3' },
      { studentId: 'a', groupCode: 'H3' },     // B is missing from History
    ],
    subjectKeys: ['EL', 'HIST', 'GEOG'],
  };
  const gaps = S.coverageGaps(model);
  // B has no History class; C's EL G2 has no class either. GEOG has no classes
  // at all, so it is "not set up yet" rather than a gap.
  assert.deepStrictEqual(gaps.map((g) => g.key + ' ' + g.value + ' x' + g.students.length),
    ['EL EL G2 x1', 'HIST HIST G3 x1']);
  assert.deepStrictEqual(gaps[1].students, ['b']);

  // putting B in the class closes the gap
  model.memberships.push({ studentId: 'b', groupCode: 'H3' });
  assert.deepStrictEqual(S.coverageGaps(model).map((g) => g.value), ['EL G2']);
});

test('an update reports what it changed, student by student', () => {
  const model = {
    students: [
      { id: 'a', name: 'Alice', class: '1R1', level: '1', gender: 'F', pg: '3', tg: 'SG1',
        origin: 'file', sourceName: 'Alice', subjects: { EL: 'EL G3' } },
      { id: 'b', name: 'Bob', class: '1R1', level: '1', gender: 'M', pg: '2', tg: 'SG2',
        origin: 'file', sourceName: 'Bob', subjects: { EL: 'EL G2' } },
    ],
    groups: [], memberships: [], subjectKeys: ['EL'], sources: [],
  };
  const res = S.applyLevelUpdate(model, [
    { name: 'Alice', class: '1R2', level: '1', gender: 'F', pg: '1', tg: 'SG4', subjects: { EL: 'EL G2' } },
    { name: 'Cara', class: '1R1', level: '1', gender: 'F', pg: '1', tg: 'SG3', subjects: { EL: 'EL G1' } },
  ], ['EL']);
  const kinds = res.changes.map((c) => c.kind);
  assert.deepStrictEqual(kinds, ['moved', 'pg', 'tg', 'subject', 'added', 'missing']);
  assert.ok(res.changes[0].text.includes('1R1 → 1R2'));
  assert.ok(res.changes[3].text.includes('EL G3 → EL G2'));
  assert.ok(res.changes[4].text.includes('Cara'));
  assert.ok(res.changes[5].text.includes('Bob'));
  // running the same file again reports nothing new (Bob is still absent from
  // it, and stays reported until someone decides to remove him)
  const again = S.applyLevelUpdate(model, [
    { name: 'Alice', class: '1R2', level: '1', gender: 'F', pg: '1', tg: 'SG4', subjects: { EL: 'EL G2' } },
    { name: 'Cara', class: '1R1', level: '1', gender: 'F', pg: '1', tg: 'SG3', subjects: { EL: 'EL G1' } },
  ], ['EL']);
  assert.deepStrictEqual(again.changes.map((c) => c.kind), ['missing']);
});

test('positional Sub 5/6/7 columns fold into one subject each', () => {
  // POA under Sub 5 for one student and Sub 7 for the next is one subject,
  // and "PHY"/"Phy" is one spelling, not two columns.
  const rows = [
    ['Name', 'Class', 'Sub 5', 'Sub 6', 'Sub 7'],
    ['Alice', '4E1', 'POA', 'Sci PC G2', 'PHY'],
    ['Bob', '4E1', 'Sci PC', 'DT G2', 'POA G2'],
    ['Cara', '4E2', 'Phy', 'POA', 'DT'],
  ];
  const res = S.importStudents(rows, {
    headerRow: 0,
    cols: { name: 0, class: 1 },
    subjectCols: [],
    slotCols: [2, 3, 4],
    dialect: 'plain',
  });
  assert.deepStrictEqual(res.students[0].subjects, { POA: 'POA', 'Sci PC': 'Sci PC G2', PHY: 'PHY' });
  assert.deepStrictEqual(res.students[1].subjects, { 'Sci PC': 'Sci PC', DT: 'DT G2', POA: 'POA G2' });
  // Cara's "Phy" lands under the PHY key already in use, spelled that way
  assert.deepStrictEqual(res.students[2].subjects, { PHY: 'PHY', POA: 'POA', DT: 'DT' });

  // the value names its subject, so G2 in one column never collides with
  // another subject's G2 when classes are discovered from the data
  const found = S.discoverClasses(res.students, 'Sec 4').filter((g) => !g.suspect);
  const names = found.map((g) => g.autoMatch).sort();
  assert.ok(names.includes('DT=DT G2'), names.join(' | '));
  assert.ok(names.includes('POA=POA G2'), names.join(' | '));
});

test('a namelist prints in the school\'s own layout', () => {
  const group = { code: 'G', name: 'SS/Geo 3 A', subject: 'HUM', teachers: ['MRS TAN'],
    level: 'Sec 3', autoMatch: 'HUM=SS/Geo', autoPg: '3', autoTg: '3 A', autoClasses: '' };
  const members = [
    { id: 'a', sn: '25', class: '3S1', name: 'TAN JAE REN', gender: 'M' },
    { id: 'b', sn: '45', class: '3S2', name: 'EDGAR KAUNG ZARNI HEIN', gender: 'M' },
    { id: 'c', sn: '', class: '3S3', name: 'ADDED LATER', gender: 'F' },
  ];
  const meta = S.namelistMeta(group, members);
  // the banner across the top: level, group, subject, head count
  assert.deepStrictEqual(meta,
    { level: 'Sec 3', band: 'PG 3 A', subject: 'SS/Geo', total: 3 });

  const html = S.namelistHtml(group, members, (v) => String(v));
  assert.ok(html.includes('Total pax: <strong>3</strong>'));
  assert.deepStrictEqual(
    (html.match(/<th>([^<]+)<\/th>/g) || []).map((h) => h.replace(/<\/?th>/g, '')),
    ['S/N', 'Class', 'Name', 'Gender', 'Note']);
  // the school's own S/N is kept; a student added here falls back to their row
  assert.ok(html.includes('>25<') && html.includes('>45<') && html.includes('>3<'));
  assert.ok(html.includes('TAN JAE REN') && html.includes('>M<') && html.includes('nl-note'));

  // a class with no rule reads its banner off the students instead
  const plain = S.namelistMeta({ code: 'P', name: 'Remedial', subject: '', teachers: [] },
    [{ class: '3S1', level: 'Sec 3', pg: '2', tg: '2 A/BC', name: 'X' }]);
  assert.strictEqual(plain.level, 'Sec 3');
  assert.strictEqual(plain.band, 'PG 2 A/BC');
  assert.strictEqual(plain.subject, 'Remedial');
});

test('subject-based banding: the PG fills in a band the label leaves out', () => {
  const students = [
    { id: 'a', name: 'A', pg: '3', class: '3S1', subjects: { HUM: 'SS/Hist' } },       // G3 by PG
    { id: 'b', name: 'B', pg: '3', class: '3S2', subjects: { HUM: 'SSHist G3' } },     // spelt out
    { id: 'c', name: 'C', pg: '2', class: '3S3', subjects: { HUM: 'SS/Hist G3' } },    // above their PG
    { id: 'd', name: 'D', pg: '2', class: '3S4', subjects: { HUM: 'SS/Hist' } },       // G2 by PG
    { id: 'e', name: 'E', pg: '1', class: '3S5', subjects: { HUM: 'SS/Geo' } },
  ];
  // the spellings fold together, and the group carries the effective band
  assert.deepStrictEqual(S.allocationOptions(students, 'HUM'),
    [{ value: 'SS/Geo G1', n: 1, implied: 1 },
      { value: 'SS/Hist G2', n: 1, implied: 1 },
      { value: 'SS/Hist G3', n: 3, implied: 1 }]);

  const g3 = { code: 'H3', autoMatch: 'HUM=SS/Hist G3' };
  const g2 = { code: 'H2', autoMatch: 'HUM=SS/Hist G2' };
  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, g3)).map((s) => s.id),
    ['a', 'b', 'c']);
  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, g2)).map((s) => s.id), ['d']);

  // a rule written the other way round finds the same students
  assert.deepStrictEqual(
    students.filter((s) => S.matchesRule(s, { code: 'X', autoMatch: 'HUM=SSHist G3' })).map((s) => s.id),
    ['a', 'b', 'c']);

  // discovery makes one class per teaching group, not per spelling
  assert.deepStrictEqual(S.discoverClasses(students, 'Sec 3').map((g) => g.autoMatch).sort(),
    ['HUM=SS/Geo G1', 'HUM=SS/Hist G2', 'HUM=SS/Hist G3']);

  // ministry-coded cells name their class outright and are left alone
  const coded = [{ id: 'k', name: 'K', pg: '2', subjects: { EL: 'G3 - K300' } }];
  assert.strictEqual(S.sbbParts('G3 - K300'), null);
  assert.ok(S.matchesRule(coded[0], { code: 'K', autoMatch: 'EL=G3 - K300' }));
  assert.ok(!S.matchesRule(coded[0], { code: 'K', autoMatch: 'EL=G2 - K200' }));

  // a student with no PG and no band in the cell keeps the label as written
  assert.strictEqual(S.allocationLabel({ pg: '', subjects: { HUM: 'SS/Hist' } }, 'HUM'), 'SS/Hist');
});

test('a teacher\'s request survives being emailed, and is only read once', () => {
  const items = [
    { teacher: 'Mrs Wong', action: 'add', group: 'K300', name: 'JASON LIM', reason: 'joined' },
    { teacher: 'Mrs Wong', action: 'remove', group: 'K300', name: 'TAN WEI MING',
      studentId: '1R5-03', reason: 'shared class — not my half' },
  ];
  items.forEach((i) => { i.id = S.requestId(i); });
  const text = S.requestsToText(items, 'Mrs Wong', '2026-08-17T02:42:00.000Z',
    (code) => 'Sec 1 HIST G3 (' + code + ')');

  // the human part comes first, and says what is being asked
  assert.ok(text.indexOf('ADD     JASON LIM') < text.indexOf('NLREQ1'));
  assert.ok(text.includes('Sec 1 HIST G3 (K300)'));

  // quoted, hard-wrapped and CRLF'd — what a mail client does to it
  const mangled = text.split('\n').map((l) => '> ' + l).join('\r\n');
  const read = S.parseRequestText(mangled);
  assert.strictEqual(read.error, undefined);
  assert.strictEqual(read.items.length, 2);
  assert.strictEqual(read.items[1].name, 'TAN WEI MING');
  assert.strictEqual(read.items[1].reason, 'shared class — not my half');

  // the same suggestion always has the same id, so re-sending adds nothing
  const model = S.emptyModel();
  assert.deepStrictEqual(S.mergeRequests(model, read.items),
    { added: 2, repeat: 0, decided: 0, reopened: 0 });
  assert.deepStrictEqual(S.mergeRequests(model, S.parseRequestText(text).items),
    { added: 0, repeat: 2, decided: 0, reopened: 0 });
  assert.strictEqual(model.requests.length, 2);

  // and one already settled does not come back as waiting
  model.requests[0].status = 'done';
  assert.strictEqual(S.openRequests(model).length, 1);
  assert.deepStrictEqual(S.mergeRequests(model, read.items),
    { added: 0, repeat: 1, decided: 1, reopened: 0 });

  assert.ok(S.parseRequestText('just some words').error.includes('NLREQ1'));
  assert.ok(S.parseRequestText('NLREQ1\nnot-base64-at-all!!\nNLEND').error.includes('damaged'));
});

test('a student who has left is held out of every class, refresh included', () => {
  const model = S.emptyModel();
  const mk = (id, status) => ({ id, name: id, class: '1R5', level: 'Sec 1', gender: 'M', pg: '3',
    tg: '', sn: '', origin: 'file', sourceName: id, status, subjects: { HIST: 'HIST G3' } });
  model.students = [mk('HERE', ''), mk('LEFT', 'left')];
  model.subjectKeys = ['HIST'];
  model.groups = [{ code: 'H1', name: 'HIST G3', subject: 'History', teachers: [],
    level: 'Sec 1', autoMatch: 'HIST=HIST G3', autoPg: '', autoTg: '', autoClasses: '' }];

  assert.strictEqual(S.autoFillGroup(model, model.groups[0]), 1);
  assert.deepStrictEqual(model.memberships, [{ studentId: 'HERE', groupCode: 'H1' }]);
  assert.strictEqual(S.hasLeft(model.students[1]), true);

  // no class exists for them, so nothing is reported as a gap either
  assert.deepStrictEqual(S.coverageGaps(model), []);
  assert.ok(!S.validateModel(model).some((w) => w.includes('LEFT')));

  // the school's file still lists them; refreshing must not undo the decision
  const imported = model.students.map((s) => ({ name: s.name, class: s.class, level: s.level,
    gender: s.gender, pg: s.pg, tg: '', sn: '', subjects: { HIST: 'HIST G3' } }));
  S.applyLevelUpdate(model, imported, ['HIST']);
  model.groups.forEach((g) => S.autoFillGroup(model, g));
  assert.strictEqual(model.students.filter((s) => s.id === 'LEFT')[0].status, 'left');
  assert.strictEqual(model.memberships.filter((m) => m.studentId === 'LEFT').length, 0);

  // and a class discovered from the data is not sized by people who have gone
  assert.strictEqual(S.discoverClasses(model.students, 'Sec 1')[0].n, 1);

  // round-trips through the workbook
  const back = S.workbookToModel(S.modelToWorkbook(model)).model;
  assert.strictEqual(back.students.filter((s) => s.id === 'LEFT')[0].status, 'left');
  assert.strictEqual(back.students.filter((s) => s.id === 'HERE')[0].status, '');
});

/* --- two admins editing at once --- */

function twoAdminFixture() {
  const base = S.emptyModel();
  const mk = (id, name, cls, extra) => Object.assign({ id, name, class: cls, level: 'Sec 1',
    gender: 'M', pg: '3', tg: 'SG1', sn: '', origin: 'file', sourceName: name, status: '',
    subjects: { HIST: 'HIST G3', EL: 'EL G2' } }, extra || {});
  base.students = [mk('s1', 'ALICE TAN', '1R1'), mk('s2', 'BOB LIM', '1R2'),
    mk('s3', 'CARA NG', '1R3')];
  base.subjectKeys = ['HIST', 'EL'];
  base.groups = [{ code: 'H1', name: 'Sec 1 HIST G3', subject: 'History', teachers: ['Mrs Wong'],
    level: 'Sec 1', autoMatch: 'HIST=HIST G3', autoPg: '', autoTg: '', autoClasses: '' }];
  base.teachers = ['Mrs Wong'];
  base.memberships = [{ studentId: 's1', groupCode: 'H1' }, { studentId: 's2', groupCode: 'H1' }];
  return base;
}

test('two admins editing different things both keep their work', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);

  mine.students[0].class = '1R9';                       // I move Alice
  mine.students[0].subjects.HIST = 'HIST G2';           // …and drop her a band
  mine.groups[0].teachers.push('Mr Tan');               // …and add a co-teacher
  mine.teachers.push('Mr Tan');
  mine.memberships.push({ studentId: 's3', groupCode: 'H1' });   // …and add Cara to the class

  theirs.students[1].gender = 'F';                      // they fix Bob's gender
  theirs.students[0].sn = '17';                         // …and give Alice an S/N
  theirs.groups[0].autoPg = '3';                        // …and tighten the rule
  theirs.students.push(Object.assign({}, base.students[0],
    { id: 's4', name: 'DEV RAJ', class: '1R4', sourceName: 'DEV RAJ' }));

  const out = S.mergeModels(base, mine, theirs);
  assert.deepStrictEqual(out.conflicts, [], 'different fields must not clash');
  const byId = Object.fromEntries(out.model.students.map((s) => [s.id, s]));
  assert.strictEqual(byId.s1.class, '1R9');             // mine
  assert.strictEqual(byId.s1.sn, '17');                 // theirs
  assert.strictEqual(byId.s1.subjects.HIST, 'HIST G2'); // mine, inside the subject map
  assert.strictEqual(byId.s2.gender, 'F');              // theirs
  assert.ok(byId.s4, 'a student they added arrives');
  assert.deepStrictEqual(out.model.groups[0].teachers, ['Mrs Wong', 'Mr Tan']);
  assert.strictEqual(out.model.groups[0].autoPg, '3');
  assert.ok(out.model.memberships.some((m) => m.studentId === 's3' && m.groupCode === 'H1'));
  assert.ok(out.changes.length, 'it can say what came in from them');
});

test('the same field, changed by both, is a clash to settle — not a silent overwrite', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  mine.students[0].class = '1R9';
  theirs.students[0].class = '1R7';
  mine.students[2].subjects.EL = 'EL G3';
  theirs.students[2].subjects.EL = 'EL G1';

  const out = S.mergeModels(base, mine, theirs);
  assert.strictEqual(out.conflicts.length, 2);
  const c = out.conflicts[0];
  assert.strictEqual(c.label, 'ALICE TAN');
  assert.strictEqual(c.fieldLabel, 'Class');
  assert.strictEqual(c.mine, '1R9');
  assert.strictEqual(c.theirs, '1R7');
  // until it is settled, the person at the keyboard keeps what they typed
  assert.strictEqual(out.model.students[0].class, '1R9');
  assert.strictEqual(out.model.students[2].subjects.EL, 'EL G3');

  S.resolveConflict(out.model, out.conflicts[0], true);
  assert.strictEqual(out.model.students[0].class, '1R7');
  S.resolveConflict(out.model, out.conflicts[1], true);
  assert.strictEqual(out.model.students[2].subjects.EL, 'EL G1');
  S.resolveConflict(out.model, out.conflicts[1], false);
  assert.strictEqual(out.model.students[2].subjects.EL, 'EL G3');
});

test('deletions: an untouched one goes through, a contested one is kept and flagged', () => {
  const base = twoAdminFixture();
  let mine = S.cloneModel(base);
  let theirs = S.cloneModel(base);
  theirs.students = theirs.students.filter((s) => s.id !== 's3');   // they delete Cara
  let out = S.mergeModels(base, mine, theirs);
  assert.strictEqual(out.conflicts.length, 0);
  assert.ok(!out.model.students.some((s) => s.id === 's3'), 'a plain deletion is honoured');

  mine = S.cloneModel(base);
  theirs = S.cloneModel(base);
  mine.students[2].class = '1R8';                                   // I edit Cara…
  theirs.students = theirs.students.filter((s) => s.id !== 's3');    // …they delete her
  out = S.mergeModels(base, mine, theirs);
  assert.strictEqual(out.conflicts.length, 1);
  assert.strictEqual(out.conflicts[0].kind, 'delete-theirs');
  assert.ok(out.model.students.some((s) => s.id === 's3'), 'nothing vanishes on a guess');
  S.resolveConflict(out.model, out.conflicts[0], true);
  assert.ok(!out.model.students.some((s) => s.id === 's3'));

  // and the other way round: I delete someone they were editing
  mine = S.cloneModel(base);
  theirs = S.cloneModel(base);
  mine.students = mine.students.filter((s) => s.id !== 's2');
  theirs.students[1].gender = 'F';
  out = S.mergeModels(base, mine, theirs);
  assert.strictEqual(out.conflicts[0].kind, 'delete-mine');
  assert.ok(!out.model.students.some((s) => s.id === 's2'), 'my deletion holds until reviewed');
  assert.strictEqual(out.model.memberships.filter((m) => m.studentId === 's2').length, 0);
  S.resolveConflict(out.model, out.conflicts[0], true);
  assert.strictEqual(out.model.students.filter((s) => s.id === 's2')[0].gender, 'F');
});

test('two admins adding a student at the same moment do not become one student', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  const newer = (name) => ({ id: '1R5-01', name, class: '1R5', level: 'Sec 1', gender: 'M',
    pg: '3', tg: '', sn: '', origin: 'added', sourceName: name, status: '',
    subjects: { HIST: 'HIST G3' } });
  mine.students.push(newer('JASON LIM'));
  mine.memberships.push({ studentId: '1R5-01', groupCode: 'H1' });
  theirs.students.push(newer('PRIYA RAJ'));
  theirs.memberships.push({ studentId: '1R5-01', groupCode: 'H1' });

  const out = S.mergeModels(base, mine, theirs);
  const names = out.model.students.map((s) => s.name);
  assert.ok(names.includes('JASON LIM') && names.includes('PRIYA RAJ'), 'both children survive');
  const ids = out.model.students.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'and they end up with different ids');
  assert.strictEqual(out.renamed.length, 1);
  // the one that was re-keyed keeps its place in the class
  const jason = out.model.students.filter((s) => s.name === 'JASON LIM')[0];
  assert.ok(out.model.memberships.some((m) => m.studentId === jason.id && m.groupCode === 'H1'));
});

test('merging is stable: nothing new means nothing changes', () => {
  const base = twoAdminFixture();
  const out = S.mergeModels(base, S.cloneModel(base), S.cloneModel(base));
  assert.deepStrictEqual(out.conflicts, []);
  assert.deepStrictEqual(out.changes, []);
  assert.strictEqual(JSON.stringify(out.model.students), JSON.stringify(base.students));
  assert.strictEqual(JSON.stringify(out.model.memberships), JSON.stringify(base.memberships));

  // and a merge of an already-merged result settles, rather than ping-ponging
  const mine = S.cloneModel(base);
  mine.students[0].class = '1R9';
  const first = S.mergeModels(base, mine, S.cloneModel(base)).model;
  const second = S.mergeModels(base, first, S.cloneModel(first)).model;
  assert.strictEqual(JSON.stringify(second.students), JSON.stringify(first.students));
});

test('an import folds onto what is already here rather than replacing it', () => {
  const current = { id: 's1', name: 'TAN WEI MING', class: '1R1', level: 'Sec 1', gender: 'M',
    pg: '3', tg: 'SG1', sn: '17', origin: 'added', sourceName: 'Tan Wei Ming', status: 'left',
    subjects: { HIST: 'HIST G3', POA: 'POA G2' } };
  // a file that knows nothing about POA, the S/N, or anything app-owned
  const imported = { id: 's1', name: 'TAN WEI MING', class: '1R2', level: 'Sec 1', gender: 'M',
    pg: '3', tg: '', sn: '', origin: 'file', sourceName: 'TAN WEI MING',
    subjects: { HIST: 'HIST G2' } };

  const out = S.mergeImportedStudent(current, imported);
  assert.strictEqual(out.class, '1R2', 'what the file does say is applied');
  assert.strictEqual(out.subjects.HIST, 'HIST G2');
  assert.strictEqual(out.subjects.POA, 'POA G2', 'a subject from another file is kept');
  assert.strictEqual(out.sn, '17', 'the office serial number is kept');
  assert.strictEqual(out.tg, 'SG1', 'a blank column does not blank the value');
  assert.strictEqual(out.status, 'left', 'a student who has left does not come back on the roll');
  assert.strictEqual(out.origin, 'added', 'and is still the app\'s own record');
  assert.strictEqual(out.sourceName, 'Tan Wei Ming', 'the spelling used for matching is kept');
});

test('two records sharing an id do not multiply through a merge', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  // the kind of workbook a bad import or a hand-edit leaves behind
  mine.students.push(Object.assign(S.cloneModel(mine.students[0]),
    { name: 'SOMEBODY ELSE', class: '1R4' }));

  const out = S.mergeModels(base, mine, theirs);
  const ids = out.model.students.map((s) => s.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no id appears twice');
  assert.strictEqual(out.model.students.filter((s) => s.id === 's1').length, 1);
  assert.strictEqual(out.model.students.filter((s) => s.name === 'ALICE TAN').length, 1,
    'the first record under the id is the one kept');
  assert.ok(out.renamed.some((r) => /share/.test(r)), 'and it says what it dropped');
});

test('a capitalisation cleanup is not silently reverted by the other admin', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  theirs.students[0].name = 'Alice Tan';        // they tidy the case; I touch nothing

  const out = S.mergeModels(base, mine, theirs);
  assert.deepStrictEqual(out.conflicts, [], 'only one side changed it');
  assert.strictEqual(out.model.students[0].name, 'Alice Tan', 'their correction survives');

  // but if we both retype it differently, that is a real clash
  const mine2 = S.cloneModel(base);
  const theirs2 = S.cloneModel(base);
  mine2.students[0].name = 'ALICE TAN JIA HUI';
  theirs2.students[0].name = 'Alice Tan';
  assert.strictEqual(S.mergeModels(base, mine2, theirs2).conflicts.length, 1);
});

test('two spellings of one subject column merge into one, losing no values', () => {
  const base = twoAdminFixture();
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  // the office file comes back with a differently-cased header
  theirs.subjectKeys = ['hist', 'EL'];
  theirs.students.forEach((s) => {
    s.subjects = { hist: s.subjects.HIST, EL: s.subjects.EL };
  });
  theirs.students[1].subjects.hist = 'HIST G2';   // and a real change inside it

  const out = S.mergeModels(base, mine, theirs);
  const keys = out.model.subjectKeys.filter((k) => S.normKey(k) === 'hist');
  assert.strictEqual(keys.length, 1, 'one column, not two spellings');
  const bob = out.model.students.filter((s) => s.id === 's2')[0];
  assert.strictEqual(bob.subjects[keys[0]], 'HIST G2', 'their edit landed on the kept spelling');
  assert.strictEqual(Object.keys(bob.subjects).filter((k) => S.normKey(k) === 'hist').length, 1);

  // and it survives the workbook, which only writes listed columns
  const back = S.workbookToModel(S.modelToWorkbook(out.model)).model;
  assert.strictEqual(back.students.filter((s) => s.id === 's2')[0].subjects[keys[0]], 'HIST G2');
});

test('modelSignature compares content, not key order', () => {
  const base = twoAdminFixture();
  const shuffled = S.cloneModel(base);
  shuffled.students = shuffled.students.map((s) => {
    const out = {};
    Object.keys(s).sort().reverse().forEach((k) => { out[k] = s[k]; });
    return out;
  });
  assert.notStrictEqual(JSON.stringify(shuffled), JSON.stringify(base),
    'the two really are ordered differently');
  assert.strictEqual(S.modelSignature(shuffled), S.modelSignature(base));

  shuffled.students[0].class = '1R9';
  assert.notStrictEqual(S.modelSignature(shuffled), S.modelSignature(base));

  // the case that caused two editors to save at each other: a merged model
  // must read as identical to the file it was merged from
  const merged = S.mergeModels(base, S.cloneModel(base), S.cloneModel(base)).model;
  assert.strictEqual(S.modelSignature(merged), S.modelSignature(base));
});

test('a suggestion re-made after being turned down is asked again', () => {
  const model = S.emptyModel();
  const ask = (made, reason) => {
    const rec = { teacher: 'Mrs Wong', group: 'H1', action: 'remove', name: 'BOB LIM',
      studentId: 's2', reason: reason, made: made, status: 'open', decided: '', note: '' };
    rec.id = S.requestId(rec);
    return rec;
  };
  const first = ask('2026-01-10T02:00:00Z', 'not in my half');
  assert.deepStrictEqual(S.mergeRequests(model, [first]),
    { added: 1, repeat: 0, decided: 0, reopened: 0 });

  // the admin turns it down
  model.requests[0].status = 'dismissed';
  model.requests[0].decided = '2026-01-11T02:00:00Z';
  model.requests[0].note = 'covered by the other teacher';

  // the same email arriving twice must NOT reopen it
  assert.deepStrictEqual(S.mergeRequests(model, [first]),
    { added: 0, repeat: 0, decided: 1, reopened: 0 });
  assert.strictEqual(S.openRequests(model).length, 0);

  // but asking again in Term 2, when the student really has left, must
  const again = ask('2026-05-02T02:00:00Z', 'he has actually left now');
  assert.deepStrictEqual(S.mergeRequests(model, [again]),
    { added: 0, repeat: 0, decided: 0, reopened: 1 });
  assert.strictEqual(S.openRequests(model).length, 1);
  assert.strictEqual(model.requests[0].reason, 'he has actually left now');
  assert.strictEqual(model.requests.length, 1, 'reopened, not duplicated');

  // something already DONE stays done — the work exists
  model.requests[0].status = 'done';
  model.requests[0].decided = '2026-05-03T02:00:00Z';
  const third = ask('2026-09-01T02:00:00Z', 'again');
  assert.strictEqual(S.mergeRequests(model, [third]).reopened, 0);
  assert.strictEqual(S.openRequests(model).length, 0);
});

test('a teacher request settled by one admin is not reopened by the other', () => {
  const base = twoAdminFixture();
  base.requests = [{ id: 'r1', made: '2026-08-17T02:00:00Z', teacher: 'Mrs Wong', group: 'H1',
    action: 'remove', name: 'BOB LIM', studentId: 's2', reason: 'not mine', status: 'open',
    decided: '', note: '' }];
  const mine = S.cloneModel(base);
  const theirs = S.cloneModel(base);
  theirs.requests[0].status = 'done';
  theirs.requests[0].note = 'off H1';
  theirs.memberships = theirs.memberships.filter((m) => m.studentId !== 's2');

  const out = S.mergeModels(base, mine, theirs);
  assert.deepStrictEqual(out.conflicts, []);
  assert.strictEqual(out.model.requests[0].status, 'done');
  assert.strictEqual(out.model.memberships.filter((m) => m.studentId === 's2').length, 0,
    'their removal applies here too');
});

test('a class can be defined by what its students do NOT take', () => {
  const mk = (id, poa, amath) => ({ id, name: id, class: '3E1', level: 'Sec 3', gender: 'M',
    pg: '3', tg: '', sn: '', origin: 'file', sourceName: id, status: '',
    subjects: Object.assign({}, poa ? { POA: poa } : {}, amath ? { AMATH: amath } : {}) });
  const students = [
    mk('takes-both', 'POA G3', 'AMATH G3'),
    mk('poa-only-1', 'POA G3', ''),
    mk('poa-only-2', 'POA G3', ''),
    mk('amath-only', '', 'AMATH G3'),
  ];
  /* Sec 3 POA is timetabled against A Math, so one allocation is taught as two
   * classes. Without a way to say "does not take", the second cannot exist. */
  const withAm = { code: 'P1', level: 'Sec 3', autoMatch: 'POA=POA G3; AMATH' };
  const noAm = { code: 'P2', level: 'Sec 3', autoMatch: 'POA=POA G3; !AMATH' };

  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, withAm)).map((s) => s.id),
    ['takes-both']);
  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, noAm)).map((s) => s.id),
    ['poa-only-1', 'poa-only-2']);
  assert.ok(!S.matchesRule(students[3], noAm), 'not taking POA at all is not "the other half"');

  // the two halves cover every POA student exactly once
  const covered = students.filter((s) => S.matchesRule(s, withAm) || S.matchesRule(s, noAm));
  assert.strictEqual(covered.length, 3);

  // it survives the workbook and a re-parse
  assert.strictEqual(S.matchersToString(S.matchers(noAm)), 'POA=POA G3; !AMATH');
  assert.deepStrictEqual(S.matchers(noAm)[1],
    { key: 'AMATH', values: [], value: '', without: true, notAbove: '' });

  /* The "without" class is about POA. Naming A Math in its rule says who is
   * excluded, not that it teaches them any A Math. */
  assert.deepStrictEqual(S.groupSubjectKeys(noAm, ['POA', 'AMATH']), ['POA']);

  // and the student who takes A Math and sits in no A Math class is still
  // reported — splitting POA must not paper over that
  const model = S.emptyModel();
  model.students = students;
  model.subjectKeys = ['POA', 'AMATH'];
  model.groups = [withAm, noAm];
  model.groups.forEach((g) => S.autoFillGroup(model, g));
  const gap = S.coverageGaps(model).filter((g) => S.normKey(g.key) === 'amath')[0];
  assert.ok(gap && gap.students.includes('amath-only'),
    'a student taking A Math with no A Math class is still flagged');
});

test('a default class takes everyone the higher bands did not', () => {
  const mk = (id, pg, subjects) => ({ id, name: id, class: '1R1', level: 'Sec 1', gender: 'F',
    pg, tg: '', sn: '', origin: 'file', sourceName: id, status: '', subjects });
  /* Lower secondary G1 HEMS: every PG 1 student, unless the office gave them a
   * humanities subject at G2 or G3 — in which case they sit in that class. */
  const students = [
    mk('hems-blank', '1', {}),                              // no humanities named
    mk('hems-g1-cell', '1', { HIST: 'SS/Hist G1' }),        // spelt out at G1
    mk('hems-implied', '1', { HIST: 'SS/Hist' }),           // band read from PG 1
    mk('up-in-hist', '1', { HIST: 'SS/Hist G2' }),          // bumped up one subject
    mk('up-in-geog', '1', { GEOG: 'SS/Geog G3' }),          // bumped up in another
    mk('up-coded', '1', { LIT: 'Literature - G2 - K220' }), // ministry-coded cell
    mk('pg2', '2', {}),                                     // not PG 1 at all
  ];
  const hems = { code: 'HEMS1', level: 'Sec 1', autoPg: '1',
    autoMatch: '!HIST>G1; !GEOG>G1; !LIT>G1' };

  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, hems)).map((s) => s.id),
    ['hems-blank', 'hems-g1-cell', 'hems-implied'],
    'a G1 cell, an implied G1 and a blank all stay; anything above leaves');

  // a cap is not the same as "takes nothing there"
  const none = { code: 'X', level: 'Sec 1', autoPg: '1', autoMatch: '!HIST' };
  assert.ok(!S.matchesRule(students[1], none), 'HIST G1 IS taking HIST');
  assert.ok(S.matchesRule(students[1], hems), 'but it is not taking it above G1');

  // it survives the workbook and a re-parse
  assert.strictEqual(S.matchersToString(S.matchers(hems)), '!HIST>G1; !GEOG>G1; !LIT>G1');
  assert.deepStrictEqual(S.matchers(hems)[0],
    { key: 'HIST', values: [], value: '', without: false, notAbove: 'G1' });

  // the cap says who is excluded, not that the class teaches History
  assert.deepStrictEqual(S.groupSubjectKeys(hems, ['HIST', 'GEOG', 'LIT']), []);

  // G2 caps too: an upper-sec class that keeps everyone but the G3 stream
  const capG2 = { code: 'Y', level: 'Sec 1', autoMatch: '!HIST>G2' };
  assert.ok(S.matchesRule(students[3], capG2), 'HIST G2 is not above G2');
  assert.ok(S.matchesRule(students[4], capG2), 'a cap on HIST says nothing about GEOG');

  // and it fills a class end to end
  const model = S.emptyModel();
  model.students = students;
  model.subjectKeys = ['HIST', 'GEOG', 'LIT'];
  model.groups = [hems];
  assert.strictEqual(S.autoFillGroup(model, hems), 3);
});

test('the band a student is really at, column by column', () => {
  const s = (pg, v) => ({ pg, subjects: { HIST: v } });
  assert.strictEqual(S.allocationBand(s('1', 'SS/Hist'), 'HIST'), 'G1', 'from the posting group');
  assert.strictEqual(S.allocationBand(s('1', 'SS/Hist G3'), 'HIST'), 'G3', 'the cell wins');
  assert.strictEqual(S.allocationBand(s('2', 'History - G2 - K200'), 'HIST'), 'G2', 'coded cell');
  assert.strictEqual(S.allocationBand(s('', 'SS/Hist'), 'HIST'), '', 'no PG, no band written');
  assert.strictEqual(S.allocationBand(s('1', ''), 'HIST'), '', 'nothing in the column');
});

test('sheet names Excel will actually open', () => {
  const taken = {};
  /* Excel refuses the whole workbook if one name is wrong, and says nothing
   * useful about which. Every rule here has bitten a real file. */
  assert.strictEqual(S.exportSheetName('SS/Hist G2 A/BC', taken), 'SS Hist G2 A BC',
    'a slash is illegal in a sheet name and arrives in every subject label');
  assert.strictEqual(S.exportSheetName('History', taken), 'History list',
    'Excel reserves "History", and a humanities export produces it');
  assert.strictEqual(S.exportSheetName('', taken), 'Sheet', 'a blank name is refused too');
  assert.strictEqual(S.exportSheetName("'quoted'", taken), 'quoted',
    'a name cannot start or end with an apostrophe');
  assert.ok(S.exportSheetName('a'.repeat(60), taken).length <= 31);

  // truncation before the suffix, or two long names collide after being cut
  const t2 = {};
  const a = S.exportSheetName('Sec 3 Social Studies History G2 Tutorial A', t2);
  const b = S.exportSheetName('Sec 3 Social Studies History G2 Tutorial B', t2);
  assert.notStrictEqual(a, b, 'two long names must not truncate onto each other');
  assert.ok(a.length <= 31 && b.length <= 31);

  // uniqueness ignores case, because Excel does
  const t3 = {};
  assert.strictEqual(S.exportSheetName('1R1', t3), '1R1');
  assert.strictEqual(S.exportSheetName('1r1', t3), '1r1 2');
});

test('splitting a roll into sheets loses nobody', () => {
  const model = buildSampleModel();
  const all = model.students;
  ['', 'class', 'level', 'pg', 'tg'].forEach((by) => {
    const sheets = S.splitStudents(model, all, by);
    const ids = [].concat.apply([], sheets.map((x) => x.students.map((s) => s.id)));
    assert.strictEqual(ids.length, all.length, by + ': every student appears once');
    assert.strictEqual(new Set(ids).size, all.length, by + ': and only once');
    assert.ok(sheets.every((x) => x.label), by + ': every sheet is named');
  });
  assert.strictEqual(S.splitStudents(model, all, '').length, 1, 'one sheet means one sheet');
  assert.ok(S.splitStudents(model, all, 'class').length > 1, 'by class gives one per class');

  /* Splitting by class or by teacher is a different shape: somebody in three
   * classes belongs on three sheets, and somebody in none must still land
   * somewhere rather than being quietly dropped. */
  const byGroup = S.splitStudents(model, all, 'group');
  const placed = new Set([].concat.apply([], byGroup.map((x) => x.students.map((s) => s.id))));
  assert.strictEqual(placed.size, all.length, 'nobody vanishes when splitting by class');
  const loose = byGroup.filter((x) => x.label === '(in no class)')[0];
  const inNoClass = all.filter((s) => !model.memberships.some((m) => m.studentId === s.id));
  assert.strictEqual(loose ? loose.students.length : 0, inNoClass.length,
    'students in no class get their own sheet rather than disappearing');
});

test('the exported workbook opens, with the tabs and rows asked for', () => {
  const model = buildSampleModel();
  const sheets = S.splitStudents(model, model.students, 'class');
  const wb = S.exportWorkbook(model, sheets, {
    columns: ['sn', 'class', 'name', 'gender', 'pg'],
    splitLabel: 'Form class', filterNote: 'Level 1', madeAt: '2026-08-18',
  });
  const bytes = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const back = XLSX.read(bytes, { type: 'array' });

  assert.strictEqual(back.SheetNames[0], 'Summary', 'the summary comes first');
  assert.strictEqual(back.SheetNames.length, sheets.length + 1);
  assert.ok(back.SheetNames.every((n) => n.length <= 31 && !/[\\\/\?\*\[\]:]/.test(n)),
    'every tab name survived: ' + back.SheetNames.join(', '));

  const first = sheets[0];
  const rows = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[1]], { header: 1 });
  assert.deepStrictEqual(rows[0], ['S/N', 'Class', 'Name', 'Gender', 'PG'],
    'the header is the columns that were asked for, in order');
  assert.strictEqual(rows.length - 1, first.students.length, 'one row per student');
  assert.strictEqual(rows[1][2], first.students[0].name);

  const summary = XLSX.utils.sheet_to_json(back.Sheets.Summary, { header: 1 });
  const flat = JSON.stringify(summary);
  assert.ok(flat.includes('Form class') && flat.includes('Level 1'),
    'the summary records what the export was and what it left out');
  assert.ok(flat.includes(String(model.students.length)), 'and the total it came to');
});

test('the band written in a cell beats the one the posting group implies', () => {
  const mk = (id, pg, sci) => ({ id, name: id, class: '3E1', level: 'Sec 3', gender: 'M',
    pg, tg: '', sn: '', origin: 'file', sourceName: id, status: '', subjects: { SCI: sci } });
  const students = [
    mk('pg1-said-g2', '1', 'Sci PC G2'),   // PG1, but the cell says G2
    mk('pg1-blank', '1', 'Sci PC'),        // PG1, nothing written -> G1
    mk('pg2-blank', '2', 'Sci PC'),        // PG2, nothing written -> G2
  ];
  assert.strictEqual(S.allocationLabel(students[0], 'SCI'), 'Sci PC G2');
  assert.strictEqual(S.allocationLabel(students[1], 'SCI'), 'Sci PC G1');
  assert.strictEqual(S.allocationLabel(students[2], 'SCI'), 'Sci PC G2');

  // two teaching groups, not three spellings
  assert.deepStrictEqual(S.allocationOptions(students, 'SCI').map((o) => o.value),
    ['Sci PC G1', 'Sci PC G2']);

  /* The point: a PG1 student whose cell names G2 belongs in the G2 class,
   * beside the PG2 students whose cell names no band at all. */
  const g2 = { code: 'G2', level: 'Sec 3', autoMatch: 'SCI=Sci PC G2' };
  const g1 = { code: 'G1', level: 'Sec 3', autoMatch: 'SCI=Sci PC G1' };
  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, g2)).map((s) => s.id),
    ['pg1-said-g2', 'pg2-blank']);
  assert.deepStrictEqual(students.filter((s) => S.matchesRule(s, g1)).map((s) => s.id),
    ['pg1-blank']);
});

/* ---- which backups survive a prune ---------------------------------- */

const bk = (d, t) => `namelist-${d}-${t}.xlsx`;

test('three saves in one afternoon keep all three', () => {
  const names = [bk('20260818', '090000'), bk('20260818', '091500'), bk('20260818', '093000')];
  const out = S.backupsToKeep(names, { newest: 3, days: 14 });
  assert.deepStrictEqual(out.drop, []);
  assert.deepStrictEqual(out.keep, names);
});

test('a busy day keeps the newest three and the one the day opened with', () => {
  const names = [];
  for (let h = 9; h < 17; h++) names.push(bk('20260818', String(h).padStart(2, '0') + '0000'));
  const out = S.backupsToKeep(names, { newest: 3, days: 14 });
  assert.deepStrictEqual(out.keep, [
    bk('20260818', '090000'),                                  // what Tuesday opened with
    bk('20260818', '140000'), bk('20260818', '150000'), bk('20260818', '160000'),
  ]);
  assert.strictEqual(out.drop.length, 4);
});

test('a fortnight of daily saves keeps one a day', () => {
  const names = [];
  for (let d = 1; d <= 10; d++) {
    const day = '202608' + String(d).padStart(2, '0');
    names.push(bk(day, '080000'), bk(day, '170000'));
  }
  const out = S.backupsToKeep(names, { newest: 3, days: 14 });
  // one a day, and the last day keeps both because the newest three reach back into it
  assert.deepStrictEqual(out.keep.filter((n) => n.includes('080000')).length, 10, 'the first of each day');
  assert.ok(out.keep.includes(bk('20260810', '170000')), 'and the newest few whatever day they are on');
  assert.strictEqual(out.keep.length + out.drop.length, names.length);
});

test('older than fourteen dates and it goes, however many saves that day held', () => {
  const names = [];
  for (let d = 1; d <= 20; d++) names.push(bk('202608' + String(d).padStart(2, '0'), '080000'));
  const out = S.backupsToKeep(names, { newest: 3, days: 14 });
  assert.strictEqual(out.keep.length, 14, 'fourteen dates, and the newest three are among them');
  assert.ok(out.drop.includes(bk('20260801', '080000')));
  assert.ok(out.keep.includes(bk('20260807', '080000')), 'the fourteenth date back survives');
  assert.ok(!out.keep.includes(bk('20260806', '080000')), 'the fifteenth does not');
});

test('fourteen dates means fourteen the editor was opened, not a fortnight of calendar', () => {
  const names = [];
  for (let w = 0; w < 14; w++) {                       // once a week since March
    const d = 1 + w * 7;
    names.push(bk('20260' + (d > 30 ? '4' : '3') + String(d > 30 ? d - 30 : d).padStart(2, '0'), '080000'));
  }
  const out = S.backupsToKeep(names, { newest: 3, days: 14 });
  assert.deepStrictEqual(out.drop, [], 'a term of weekly saves is still fourteen rewind points');
});

test('a file that is not ours is never dropped', () => {
  const names = ['notes.txt', 'namelist backup FINAL.xlsx', bk('20260101', '080000'),
    bk('20260818', '090000'), bk('20260818', '091500'), bk('20260818', '093000'),
    bk('20260818', '094500')];
  const out = S.backupsToKeep(names, { newest: 3, days: 1 });
  assert.ok(out.keep.includes('notes.txt') && out.keep.includes('namelist backup FINAL.xlsx'),
    'somebody else put those there');
  assert.ok(out.drop.includes(bk('20260101', '080000')), 'but an old one of ours goes');
});

test('the backup being restored from is not deleted by the save that restores it', () => {
  const old = bk('20260701', '083000');
  const names = [old];
  for (let h = 9; h < 13; h++) names.push(bk('20260818', String(h).padStart(2, '0') + '0000'));
  assert.ok(S.backupsToKeep(names, { newest: 3, days: 1 }).drop.includes(old),
    'it would go on the usual rule');
  assert.ok(!S.backupsToKeep(names, { newest: 3, days: 1, keepNames: [old] }).drop.includes(old));
});

test('pruning twice deletes nothing the second time', () => {
  const names = [];
  for (let d = 1; d <= 20; d++) {
    const day = '202608' + String(d).padStart(2, '0');
    names.push(bk(day, '080000'), bk(day, '120000'), bk(day, '170000'));
  }
  const once = S.backupsToKeep(names, { newest: 3, days: 14 });
  assert.ok(once.drop.length > 0);
  assert.deepStrictEqual(S.backupsToKeep(once.keep, { newest: 3, days: 14 }).drop, []);
});

test('nothing to prune is not an error', () => {
  assert.deepStrictEqual(S.backupsToKeep([], { newest: 3, days: 14 }), { keep: [], drop: [] });
  assert.deepStrictEqual(S.backupsToKeep(null), { keep: [], drop: [] });
});

/* ---- what a subject column is called -------------------------------- */

test('a column is named by what the classes on it say, not by its heading', () => {
  const model = buildSampleModel();
  assert.strictEqual(S.subjectLabelFor(model, 'HIST'), 'History');
  assert.strictEqual(S.subjectLabelFor(model, 'SCI'), 'Science');
});

test('the subjects on offer are the ones classes exist for, named as they name them', () => {
  const model = buildSampleModel();
  const choices = S.subjectChoices(model);
  assert.deepStrictEqual(choices.map((c) => c.label),
    ['English Language', 'Geography', 'History', 'Literature', 'Mathematics', 'Science'],
    'no MT or HMT: nothing is taught under those headings');
  assert.deepStrictEqual(S.subjectChoiceFor(model, 'History').keys, ['HIST'],
    'and each carries the column its classes read');
});

test('one subject spread over two columns offers both', () => {
  const model = {
    subjectKeys: ['SS', 'HUM'], subjectLabels: [], students: [], memberships: [],
    groups: [
      { code: 'a', subject: 'Social Studies', autoMatch: 'SS=Soc G1' },
      { code: 'b', subject: 'Social Studies', autoMatch: 'HUM=Soc G2' },
      { code: 'c', subject: 'Geography', autoMatch: 'HUM=Geog G3' },
    ],
  };
  assert.deepStrictEqual(S.subjectChoices(model).map((c) => c.label), ['Geography', 'Social Studies']);
  assert.deepStrictEqual(S.subjectChoiceFor(model, 'Social Studies').keys, ['SS', 'HUM']);
  assert.deepStrictEqual(S.subjectChoiceFor(model, 'Social Studies').codes, ['a', 'b'],
    'and the classes under it, for anyone the office file has not filled in');
  assert.strictEqual(S.subjectChoiceFor(model, 'Woodwork'), null);
});

test('the commonest name wins, so one oddly named class renames nothing', () => {
  const model = {
    subjectKeys: ['SS'], subjectLabels: [], students: [], memberships: [],
    groups: [
      { code: 'a', subject: 'Social Studies', autoMatch: 'SS=Soc G1' },
      { code: 'b', subject: 'Social Studies', autoMatch: 'SS=Soc G2' },
      { code: 'c', subject: 'SS/Hist', autoMatch: 'SS=Soc G3' },
    ],
  };
  assert.strictEqual(S.subjectLabelFor(model, 'SS'), 'Social Studies');
});

test('nothing built on it yet falls back to the subject list, when that is unambiguous', () => {
  const bare = { subjectKeys: ['HIST'], subjectLabels: ['History', 'Geography'],
    groups: [], students: [], memberships: [] };
  assert.strictEqual(S.subjectLabelFor(bare, 'HIST'), 'History');
});

test('and never guesses between two subjects a heading could mean', () => {
  const both = { subjectKeys: ['MA'], subjectLabels: ['Mathematics', 'Malay'],
    groups: [], students: [], memberships: [] };
  assert.strictEqual(S.subjectLabelFor(both, 'MA'), 'MA', 'the heading stands rather than a coin toss');
  assert.strictEqual(S.subjectLabelFor(both, 'POA'), 'POA', 'a column nobody has named stays as it is');
});

console.log(passed + ' tests passed');
