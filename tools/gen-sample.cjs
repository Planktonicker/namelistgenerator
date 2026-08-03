#!/usr/bin/env node
/* Generates sample/namelist.xlsx and sample/data.js with realistic fake data.
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

const CLASSES = ['4A', '4B', '4C', '4D', '4E'];
const STUDENTS_PER_CLASS = 28;

const COMBOS = [
  'Physics / Chemistry / Geography',
  'Physics / Chemistry / Biology',
  'Chemistry / Biology / Geography',
  'Physics / Chemistry / Literature',
  'Chemistry / Biology / History',
  'Geography / History / Literature',
];

/* subject → the option groups students of that subject are spread across */
const OPTION_GROUPS = {
  Physics: ['PHY-1', 'PHY-2'],
  Chemistry: ['CHEM-1', 'CHEM-2'],
  Biology: ['BIO-1'],
  Geography: ['GEO-1'],
  History: ['HIST-1'],
  Literature: ['LIT-1'],
};

const TEACHERS = {
  english: ['Mrs Lim Bee Leng', 'Mr Daniel Tan', 'Ms Nur Aisyah', 'Mrs Grace Chua', 'Mr Marcus Lee'],
  maths: ['Mr Rajesh Kumar', 'Mdm Halimah Yusof', 'Ms Serene Goh', 'Mr Alvin Ong', 'Mrs Doris Koh'],
  'PHY-1': 'Mr Benjamin Teo', 'PHY-2': 'Ms Cheryl Ng',
  'CHEM-1': 'Mrs Angela Wong', 'CHEM-2': 'Mr Faizal Ismail',
  'BIO-1': 'Dr Sarah Loh', 'GEO-1': 'Mr Kenneth Sim',
  'HIST-1': 'Ms Priyanka Nair', 'LIT-1': 'Mrs Evelyn Phua',
};

function buildSampleModel() {
  const model = S.emptyModel();

  CLASSES.forEach((cls, c) => {
    model.groups.push({ code: 'EL-' + cls, name: 'English ' + cls, subject: 'English Language', teacher: TEACHERS.english[c] });
    model.groups.push({ code: 'MA-' + cls, name: 'Mathematics ' + cls, subject: 'Mathematics', teacher: TEACHERS.maths[c] });
  });
  Object.entries(OPTION_GROUPS).forEach(([subject, codes]) => {
    codes.forEach((code) => {
      model.groups.push({ code, name: subject + ' ' + code.split('-')[1], subject, teacher: TEACHERS[code] });
    });
  });

  const optionRotation = {};
  let n = 0;
  CLASSES.forEach((cls) => {
    for (let i = 0; i < STUDENTS_PER_CLASS; i++, n++) {
      const id = 'S' + String(2601 + n).padStart(5, '0');
      const name = FIRST[n % FIRST.length] + ' ' + LAST[(n * 7 + i) % LAST.length];
      const combination = COMBOS[n % COMBOS.length];
      model.students.push({ id, name, class: cls, combination });

      model.memberships.push({ studentId: id, groupCode: 'EL-' + cls });
      model.memberships.push({ studentId: id, groupCode: 'MA-' + cls });
      combination.split('/').map((s) => s.trim()).forEach((subject) => {
        const codes = OPTION_GROUPS[subject];
        if (!codes) return;
        optionRotation[subject] = (optionRotation[subject] || 0) + 1;
        model.memberships.push({ studentId: id, groupCode: codes[optionRotation[subject] % codes.length] });
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
