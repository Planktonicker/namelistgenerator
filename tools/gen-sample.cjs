#!/usr/bin/env node
/* Generates sample/namelist.xlsx and sample/data.js with realistic fake data
 * mirroring the real school structure: classes 1R1-1R6, PG 1/2/3, per-subject
 * band tags, teachers allocated per class plus banded option groups.
 * Deterministic (no randomness) so tests and screenshots are reproducible. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

globalThis.XLSX = require('../vendor/xlsx.full.min.js');
require('../src/shared/schema.js');
const S = globalThis.NamelistSchema;

const FIRST = ['Aiden', 'Brenda', 'Clarissa', 'Darren', 'Elena', 'Farhan', 'Grace', 'Hakim',
  'Iris', 'Jun Jie', 'Kavya', 'Liang', 'Mei Ling', 'Nadia', 'Owen', 'Priya',
  'Qi Wen', 'Ryan', 'Siti', 'Timothy', 'Uma', 'Vernon', 'Wei Ting', 'Xin Yi', 'Yusof', 'Zoe'];
const LAST = ['Tan', 'Lim', 'Lee', 'Ng', 'Wong', 'Chua', 'Goh', 'Ong', 'Teo', 'Koh',
  'Abdullah', 'Kumar', 'Chen', 'Ho', 'Ismail', 'Loh', 'Nair', 'Phua', 'Sim', 'Yeo'];

const CLASSES = ['1R1', '1R2', '1R3', '1R4', '1R5', '1R6'];
const STUDENTS_PER_CLASS = 26;
const MT_LANGS = ['CL', 'ML', 'TL'];

const EL_TEACHERS = ['Mrs Lim Bee Leng', 'Mr Daniel Tan', 'Ms Nur Aisyah', 'Mrs Grace Chua', 'Mr Marcus Lee', 'Mdm Sarimah Bakar'];
const MA_TEACHERS = ['Mr Rajesh Kumar', 'Mdm Halimah Yusof', 'Ms Serene Goh', 'Mr Alvin Ong', 'Mrs Doris Koh', 'Mr Wei Jie Chan'];
const BAND_GROUPS = [
  { code: 'SCI-G3', name: 'Science G3', subject: 'Science', teachers: ['Dr Sarah Loh', 'Mr Benjamin Teo'], key: 'SCI', value: 'SCI G3' },
  { code: 'HIST-G3', name: 'History G3', subject: 'History', teachers: ['Ms Priyanka Nair'], key: 'HIST', value: 'HIST G3' },
  { code: 'GEOG-G2', name: 'Geography G2', subject: 'Geography', teachers: ['Mr Kenneth Sim'], key: 'GEOG', value: 'GEOG G2' },
  { code: 'LIT-G3', name: 'Literature G3', subject: 'Literature', teachers: ['Mrs Evelyn Phua'], key: 'LIT', value: 'LIT G3' },
];

function buildSampleModel() {
  const model = S.emptyModel();
  model.subjectKeys = ['EL', 'MT', 'HMT', 'MA', 'SCI', 'HIST', 'GEOG', 'LIT'];
  model.teachers = [...new Set([...EL_TEACHERS, ...MA_TEACHERS, ...BAND_GROUPS.flatMap((g) => g.teachers)])].sort();
  model.subjectLabels = ['English Language', 'Geography', 'History', 'Literature',
    'Mathematics', 'Science'];
  model.sources = [
    {
      level: 'Sec 1', file: 'Sec 1 Subject Allocation_14 Jan.xlsx',
      pattern: 'Sec 1 Subject Allocation', lastFile: '', lastImported: '', mapping: '',
    },
  ];

  CLASSES.forEach((cls, c) => {
    model.groups.push({
      code: 'EL-' + cls, name: 'English ' + cls, subject: 'English Language',
      teachers: [EL_TEACHERS[c]], level: '1',
      autoMatch: 'EL', autoPg: '', autoTg: '', autoClasses: cls,
    });
    model.groups.push({
      code: 'MA-' + cls, name: 'Mathematics ' + cls, subject: 'Mathematics',
      teachers: [MA_TEACHERS[c]], level: '1',
      autoMatch: 'MA', autoPg: '', autoTg: '', autoClasses: cls,
    });
  });
  BAND_GROUPS.forEach((g) => {
    model.groups.push({
      code: g.code, name: g.name, subject: g.subject,
      teachers: g.teachers, level: '1',
      autoMatch: g.key + '=' + g.value, autoPg: '', autoTg: '', autoClasses: '',
    });
  });

  let n = 0;
  CLASSES.forEach((cls) => {
    for (let i = 1; i <= STUDENTS_PER_CLASS; i++, n++) {
      const id = cls + '-' + (i < 10 ? '0' : '') + i;
      const name = FIRST[n % FIRST.length] + ' ' + LAST[(n * 7 + i) % LAST.length];
      const gender = n % 2 ? 'M' : 'F';
      const pg = String([1, 2, 3, 3][n % 4]);
      const g = 'G' + pg;
      // Subject groups run across the form classes: SG1-SG6, not 1R1-1R6.
      const tg = 'SG' + ((n % 6) + 1);
      const subjects = {
        EL: 'EL ' + g,
        MT: MT_LANGS[n % 3] + ' ' + g,
        MA: 'MA ' + g,
        SCI: 'SCI ' + g,
        HIST: 'HIST ' + g,
        GEOG: 'GEOG ' + g,
        LIT: 'LIT ' + g,
      };
      if (n % 7 === 0) subjects.HMT = n % 3 === 0 ? 'CHINESE' : 'MALAY';
      const student = { id, name, class: cls, level: '1', gender, pg, tg,
        sn: String(n + 1),                       // the school's own running number
        origin: S.ORIGIN_FILE, sourceName: name, status: '', subjects };
      model.students.push(student);

      model.memberships.push({ studentId: id, groupCode: 'EL-' + cls });
      model.memberships.push({ studentId: id, groupCode: 'MA-' + cls });
      BAND_GROUPS.forEach((bg) => {
        if (subjects[bg.key] === bg.value) {
          model.memberships.push({ studentId: id, groupCode: bg.code });
        }
      });
    }
  });
  return model;
}

module.exports = { buildSampleModel };

if (require.main === module) {
  const outDir = path.join(__dirname, '..', 'sample');
  fs.mkdirSync(outDir, { recursive: true });
  const model = buildSampleModel();
  const warnings = S.validateModel(model);
  if (warnings.length) {
    console.error('Sample model has warnings:', warnings);
    process.exit(1);
  }
  const bytes = globalThis.XLSX.write(S.modelToWorkbook(model), { bookType: 'xlsx', type: 'buffer' });
  fs.writeFileSync(path.join(outDir, 'namelist.xlsx'), bytes);
  fs.writeFileSync(path.join(outDir, 'data.js'), S.modelToDataJs(model, new Date().toISOString()));
  console.log('sample/: ' + model.students.length + ' students, ' + model.groups.length +
    ' groups, ' + model.memberships.length + ' memberships');
}
