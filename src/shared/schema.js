/* Shared data layer for the namelist app.
 *
 * Model shape used everywhere:
 *   {
 *     students:    [{ id, name, class, gender, pg, origin, subjects: { KEY: value } }],
 *     groups:      [{ code, name, subject, teacher }],
 *     memberships: [{ studentId, groupCode }],
 *     subjectKeys: ['TG', 'EL', 'MT', ...],
 *   }
 *
 * Each subject/band column from the school's worksheet (EL, MT, MA, …) is a
 * key in `subjects`, holding that student's allocation ("EL G3", "CL G2", …).
 * Only non-empty allocations are stored. `subjectKeys` preserves column order.
 *
 * `origin` records where a student came from: ORIGIN_FILE for students read
 * from the school's official file, ORIGIN_ADDED for students entered in the
 * app. Added students are never proposed for removal when a level is
 * refreshed from the school file, since that file does not know about them.
 *
 * Runs as a plain script in the browser and via require() in Node tests.
 * Workbook conversion needs SheetJS available as globalThis.XLSX; the
 * index/validation helpers work without it (the teacher page loads no XLSX).
 */
(function () {
  'use strict';

  var ORIGIN_FILE = 'file';
  var ORIGIN_ADDED = 'added';

  var STUDENT_HEADERS = ['StudentID', 'Name', 'Class', 'Gender', 'PG', 'Origin'];
  var GROUP_HEADERS = ['GroupCode', 'GroupName', 'Subject', 'Teacher', 'AutoSubject', 'AutoValue', 'AutoClasses'];
  var MEMBERSHIP_HEADERS = ['StudentID', 'GroupCode'];
  var SOURCE_HEADERS = ['Level', 'SourceFile', 'FilePattern', 'LastFile', 'LastImported'];

  var STUDENT_FIELDS = {
    id: ['studentid', 'id', 'studentno', 'indexno', 'regno', 'nric'],
    name: ['name', 'studentname', 'fullname'],
    class: ['class', 'formclass', 'form'],
    gender: ['gender', 'sex'],
    pg: ['pg', 'postinggroup', 'stream'],
    origin: ['origin'],
  };
  var GROUP_FIELDS = {
    code: ['groupcode', 'code'],
    name: ['groupname', 'group', 'name'],
    subject: ['subject'],
    teacher: ['teacher', 'teachername', 'tutor'],
    autoKey: ['autosubject'],
    autoValue: ['autovalue'],
    autoClasses: ['autoclasses'],
  };
  var MEMBERSHIP_FIELDS = {
    studentId: ['studentid', 'id', 'student'],
    groupCode: ['groupcode', 'group', 'code'],
  };
  var SOURCE_FIELDS = {
    level: ['level'],
    file: ['sourcefile'],
    pattern: ['filepattern', 'pattern'],
    lastFile: ['lastfile'],
    lastImported: ['lastimported'],
  };

  function xlsx() {
    if (!globalThis.XLSX) throw new Error('SheetJS (XLSX) is not loaded');
    return globalThis.XLSX;
  }

  function norm(v) {
    return String(v == null ? '' : v).trim();
  }

  function normKey(v) {
    return norm(v).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function emptyModel() {
    return { students: [], groups: [], memberships: [], subjectKeys: [], sources: [] };
  }

  /* Match a header row against field aliases; returns { field: columnIndex }. */
  function mapHeaders(headerRow, fields) {
    var keys = headerRow.map(normKey);
    var idx = {};
    Object.keys(fields).forEach(function (field) {
      for (var a = 0; a < fields[field].length; a++) {
        var at = keys.indexOf(fields[field][a]);
        if (at !== -1) { idx[field] = at; return; }
      }
    });
    return idx;
  }

  function sheetRows(ws) {
    return xlsx().utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  }

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) if (norm(row[i]) !== '') return false;
    return true;
  }

  function readTable(ws, fields, requiredFields, sheetName, warnings) {
    var rows = sheetRows(ws);
    if (!rows.length) return [];
    var idx = mapHeaders(rows[0], fields);
    requiredFields.forEach(function (field) {
      if (!(field in idx)) {
        warnings.push('Sheet "' + sheetName + '": no column matched "' + field + '" — those values will be blank.');
      }
    });
    var out = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || isBlankRow(row)) continue;
      var rec = {};
      Object.keys(fields).forEach(function (field) {
        rec[field] = field in idx ? norm(row[idx[field]]) : '';
      });
      var missing = requiredFields.filter(function (f) { return rec[f] === ''; });
      if (missing.length) {
        warnings.push('Sheet "' + sheetName + '" row ' + (r + 1) + ': missing ' + missing.join(', ') + ' — row skipped.');
        continue;
      }
      out.push(rec);
    }
    return out;
  }

  function findSheet(wb, wanted) {
    var target = normKey(wanted);
    for (var i = 0; i < wb.SheetNames.length; i++) {
      if (normKey(wb.SheetNames[i]) === target) return wb.Sheets[wb.SheetNames[i]];
    }
    return null;
  }

  /* The Students sheet has the fixed columns plus one column per subject/band:
   * every non-empty header that isn't a fixed field becomes a subject key. */
  function readStudents(ws, warnings) {
    var rows = sheetRows(ws);
    if (!rows.length) return { students: [], subjectKeys: [] };
    var headers = rows[0];
    var idx = mapHeaders(headers, STUDENT_FIELDS);
    ['id', 'name'].forEach(function (f) {
      if (!(f in idx)) warnings.push('Sheet "Students": no column matched "' + f + '" — those values will be blank.');
    });
    var taken = {};
    Object.keys(idx).forEach(function (f) { taken[idx[f]] = true; });
    var subjectCols = [];
    headers.forEach(function (h, i) {
      var label = norm(h);
      if (label && !taken[i]) subjectCols.push({ index: i, header: label });
    });
    var students = [];
    for (var r = 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row || isBlankRow(row)) continue;
      var rec = { id: '', name: '', class: '', gender: '', pg: '', origin: '', subjects: {} };
      Object.keys(STUDENT_FIELDS).forEach(function (f) {
        rec[f] = f in idx ? norm(row[idx[f]]) : '';
      });
      // Files written before the Origin column existed: assume the students
      // came from the school file (the pre-existing behaviour).
      if (rec.origin !== ORIGIN_ADDED) rec.origin = ORIGIN_FILE;
      if (!rec.id || !rec.name) {
        warnings.push('Sheet "Students" row ' + (r + 1) + ': missing ' +
          (!rec.id ? 'id' : 'name') + ' — row skipped.');
        continue;
      }
      subjectCols.forEach(function (sc) {
        var v = norm(row[sc.index]);
        if (v) rec.subjects[sc.header] = v;
      });
      students.push(rec);
    }
    return { students: students, subjectKeys: subjectCols.map(function (sc) { return sc.header; }) };
  }

  function workbookToModel(wb) {
    var warnings = [];
    var model = emptyModel();
    var students = findSheet(wb, 'Students');
    var groups = findSheet(wb, 'Groups');
    var memberships = findSheet(wb, 'Memberships');
    if (students) {
      var read = readStudents(students, warnings);
      model.students = read.students;
      model.subjectKeys = read.subjectKeys;
    }
    else warnings.push('Sheet "Students" not found.');
    if (groups) model.groups = readTable(groups, GROUP_FIELDS, ['code'], 'Groups', warnings);
    else warnings.push('Sheet "Groups" not found.');
    if (memberships) model.memberships = readTable(memberships, MEMBERSHIP_FIELDS, ['studentId', 'groupCode'], 'Memberships', warnings);
    else warnings.push('Sheet "Memberships" not found.');
    var sources = findSheet(wb, 'Sources');   // optional sheet — older files lack it
    if (sources) model.sources = readTable(sources, SOURCE_FIELDS, ['level'], 'Sources', warnings);
    return { model: model, warnings: warnings.concat(validateModel(model)) };
  }

  function modelToWorkbook(model) {
    var X = xlsx();
    var wb = X.utils.book_new();
    var ws;

    var keys = model.subjectKeys || [];
    ws = X.utils.aoa_to_sheet([STUDENT_HEADERS.concat(keys)].concat(model.students.map(function (s) {
      return [s.id, s.name, s.class, s.gender, s.pg, s.origin || ORIGIN_FILE].concat(keys.map(function (k) {
        return (s.subjects && s.subjects[k]) || '';
      }));
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 8 }, { wch: 5 }, { wch: 8 }]
      .concat(keys.map(function () { return { wch: 12 }; }));
    X.utils.book_append_sheet(wb, ws, 'Students');

    ws = X.utils.aoa_to_sheet([GROUP_HEADERS].concat(model.groups.map(function (g) {
      return [g.code, g.name, g.subject, g.teacher, g.autoKey, g.autoValue, g.autoClasses];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    X.utils.book_append_sheet(wb, ws, 'Groups');

    ws = X.utils.aoa_to_sheet([MEMBERSHIP_HEADERS].concat(model.memberships.map(function (m) {
      return [m.studentId, m.groupCode];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, ws, 'Memberships');

    ws = X.utils.aoa_to_sheet([SOURCE_HEADERS].concat((model.sources || []).map(function (s) {
      return [s.level, s.file, s.pattern, s.lastFile, s.lastImported];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 42 }, { wch: 30 }, { wch: 42 }, { wch: 22 }];
    X.utils.book_append_sheet(wb, ws, 'Sources');

    return wb;
  }

  function modelToDataJs(model, savedAtIso) {
    var data = {
      savedAt: savedAtIso,
      students: model.students,
      groups: model.groups,
      memberships: model.memberships,
      subjectKeys: model.subjectKeys || [],
    };
    return '// Auto-generated by admin.html — do not edit by hand.\n' +
      'window.NAMELIST_DATA = ' + JSON.stringify(data, null, 1) + ';\n';
  }

  function validateModel(model) {
    var warnings = [];
    var studentIds = {};
    var groupCodes = {};
    model.students.forEach(function (s) {
      if (studentIds[s.id]) warnings.push('Duplicate StudentID "' + s.id + '" (' + s.name + ').');
      studentIds[s.id] = true;
    });
    model.groups.forEach(function (g) {
      if (groupCodes[g.code]) warnings.push('Duplicate GroupCode "' + g.code + '".');
      groupCodes[g.code] = true;
      if (!g.teacher) warnings.push('Group "' + g.code + '" has no teacher assigned.');
    });
    var seen = {};
    model.memberships.forEach(function (m) {
      if (!studentIds[m.studentId]) warnings.push('Membership refers to unknown StudentID "' + m.studentId + '".');
      if (!groupCodes[m.groupCode]) warnings.push('Membership refers to unknown GroupCode "' + m.groupCode + '".');
      var key = m.studentId + ' ' + m.groupCode;
      if (seen[key]) warnings.push('Duplicate membership: student "' + m.studentId + '" in group "' + m.groupCode + '".');
      seen[key] = true;
    });
    return warnings;
  }

  function cmp(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function byClassThenName(a, b) {
    return cmp(a.class, b.class) || cmp(a.name, b.name) || cmp(a.id, b.id);
  }

  /* ---- raw-document import ------------------------------------------- */

  /* Find the most plausible header row in the first 15 rows of a sheet
   * (real documents often carry titles/dates above the actual table). */
  function detectHeaderRow(rows) {
    var best = 0;
    var bestScore = -1;
    var limit = Math.min(rows.length, 15);
    for (var r = 0; r < limit; r++) {
      var m = mapHeaders(rows[r] || [], STUDENT_FIELDS);
      var score = Object.keys(m).length + ('name' in m ? 2 : 0);
      if (score > bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  /* Extract students from raw sheet rows.
   *   mapping: { headerRow, cols: {id?, name, class?, gender?, pg?},
   *              subjectCols: [{ index, header }] }
   * Rows without a name are skipped. Without an id column, IDs are
   * generated as "<class>-01", "<class>-02", … in row order, which keeps
   * per-class register order sortable. Each selected subject column becomes
   * a key in the student's `subjects` map, holding the raw cell value. */
  function importStudents(rows, mapping) {
    var warnings = [];
    var students = [];
    var counters = {};
    var usedIds = {};
    var cols = mapping.cols || {};
    function cell(row, key) {
      return cols[key] == null || cols[key] === '' ? '' : norm(row[cols[key]]);
    }
    for (var r = mapping.headerRow + 1; r < rows.length; r++) {
      var row = rows[r] || [];
      if (isBlankRow(row)) continue;
      var name = cell(row, 'name');
      if (!name) { warnings.push('Row ' + (r + 1) + ': no name — skipped.'); continue; }
      var cls = cell(row, 'class');
      var id = cell(row, 'id');
      if (!id) {
        var base = cls || 'S';
        counters[base] = (counters[base] || 0) + 1;
        id = base + '-' + (counters[base] < 10 ? '0' : '') + counters[base];
      }
      if (usedIds[id]) { warnings.push('Row ' + (r + 1) + ': duplicate ID "' + id + '" — skipped.'); continue; }
      usedIds[id] = true;
      var subjects = {};
      (mapping.subjectCols || []).forEach(function (sc) {
        var v = norm(row[sc.index]);
        if (v) subjects[norm(sc.header)] = v;
      });
      students.push({
        id: id, name: name, class: cls,
        gender: cell(row, 'gender'), pg: cell(row, 'pg'),
        origin: ORIGIN_FILE, subjects: subjects,
      });
    }
    return { students: students, warnings: warnings };
  }

  /* Update one level's students from a freshly imported school file,
   * preserving student IDs (and therefore group memberships) by matching
   * names. Only the classes present in `imported` are touched, and on
   * matched students only the subject columns in `importedKeys` are
   * overwritten (a file without a GEOG column never clears GEOG).
   * Nothing is removed here — students missing from the file are reported
   * in the result so the caller can decide. Students added inside the app
   * (ORIGIN_ADDED) are never reported as missing: the school's file does not
   * know about them, so their absence from it means nothing. A matched
   * added-student is adopted (origin becomes ORIGIN_FILE) rather than
   * duplicated, for when the office finally lists them.
   * Returns { classes, updated, added, addedIds, keptAddedIds,
   *           missingIds, missingLabels }. */
  function applyLevelUpdate(model, imported, importedKeys) {
    importedKeys = importedKeys || [];
    var classSet = {};
    imported.forEach(function (s) { if (s.class) classSet[s.class] = true; });

    var pool = model.students.filter(function (s) { return classSet[s.class]; });
    var byNameClass = {};
    var byName = {};
    pool.forEach(function (s) {
      var nk = normKey(s.name);
      byNameClass[nk + '|' + s.class] = s;
      byName[nk] = nk in byName ? null : s;   // null marks an ambiguous name
    });

    var usedIds = {};
    model.students.forEach(function (s) { usedIds[s.id] = true; });
    function freeId(cls) {
      var base = cls || 'S';
      var i = 1, id;
      do {
        id = base + '-' + (i < 10 ? '0' : '') + i;
        i++;
      } while (usedIds[id]);
      usedIds[id] = true;
      return id;
    }

    var matched = {};
    var updated = 0, added = 0;
    var addedIds = [];
    imported.forEach(function (imp) {
      var nk = normKey(imp.name);
      var m = byNameClass[nk + '|' + imp.class] || byName[nk] || null;
      if (m && matched[m.id]) m = null;
      if (m) {
        matched[m.id] = true;
        m.name = imp.name;
        m.origin = ORIGIN_FILE;   // adopted: the school's file now lists them
        if (imp.class) m.class = imp.class;
        if (imp.gender) m.gender = imp.gender;
        if (imp.pg) m.pg = imp.pg;
        m.subjects = m.subjects || {};
        importedKeys.forEach(function (k) {
          if (imp.subjects[k]) m.subjects[k] = imp.subjects[k];
          else delete m.subjects[k];
        });
        updated++;
      } else {
        var newId = freeId(imp.class);
        model.students.push({
          id: newId, name: imp.name, class: imp.class,
          gender: imp.gender, pg: imp.pg, origin: ORIGIN_FILE, subjects: imp.subjects,
        });
        addedIds.push(newId);
        added++;
      }
    });

    importedKeys.forEach(function (k) {
      if (!model.subjectKeys.some(function (e) { return normKey(e) === normKey(k); })) {
        model.subjectKeys.push(k);
      }
    });

    var unmatched = pool.filter(function (s) { return !matched[s.id]; });
    // Students entered in the app are kept without question — the school's
    // file has no opinion about them.
    var missing = unmatched.filter(function (s) { return s.origin !== ORIGIN_ADDED; });
    var keptAdded = unmatched.filter(function (s) { return s.origin === ORIGIN_ADDED; });
    return {
      classes: Object.keys(classSet).sort(cmp),
      updated: updated,
      added: added,
      addedIds: addedIds,
      keptAddedIds: keptAdded.map(function (s) { return s.id; }),
      missingIds: missing.map(function (s) { return s.id; }),
      missingLabels: missing.map(function (s) { return s.name + ' (' + s.class + ')'; }),
    };
  }

  /* Next unused "<class>-NN" id, so a student added by hand slots into the
   * class register without clashing with imported ids. */
  function nextFreeId(model, cls) {
    var used = {};
    model.students.forEach(function (s) { used[s.id] = true; });
    var base = norm(cls) || 'S';
    var i = 1, id;
    do {
      id = base + '-' + (i < 10 ? '0' : '') + i;
      i++;
    } while (used[id]);
    return id;
  }

  /* ---- auto-allocation rules ------------------------------------------ */

  /* A group's rule can name a subject column (with an optional band value)
   * and/or a class filter — comma-separated class names or prefixes
   * ("1R" matches 1R1…1R6). Both parts must hold when both are set. */
  function groupHasRule(group) {
    return !!(norm(group.autoKey) || norm(group.autoClasses));
  }

  function matchesRule(student, group) {
    if (!groupHasRule(group)) return false;
    var classes = norm(group.autoClasses);
    if (classes) {
      var sc = normKey(student.class);
      var ok = classes.split(/[,;]+/).some(function (t) {
        t = normKey(t);
        return t && sc.indexOf(t) === 0;
      });
      if (!ok) return false;
    }
    var key = norm(group.autoKey);
    if (key) {
      var v = student.subjects ? norm(student.subjects[key]) : '';
      if (!v) return false;
      var want = norm(group.autoValue);
      if (want && normKey(v) !== normKey(want)) return false;
    }
    return true;
  }

  /* Add every rule-matching student to the group. Never removes anyone, so
   * manual changes survive. Pass onlyIds to restrict to specific students
   * (e.g. the ones a level update just added). Returns how many were added. */
  function autoFillGroup(model, group, onlyIds) {
    if (!groupHasRule(group)) return 0;
    var only = null;
    if (onlyIds) {
      only = {};
      onlyIds.forEach(function (id) { only[id] = true; });
    }
    var existing = {};
    model.memberships.forEach(function (m) {
      if (m.groupCode === group.code) existing[m.studentId] = true;
    });
    var added = 0;
    model.students.forEach(function (s) {
      if (only && !only[s.id]) return;
      if (existing[s.id] || !matchesRule(s, group)) return;
      model.memberships.push({ studentId: s.id, groupCode: group.code });
      added++;
    });
    return added;
  }

  /* Pick the most recently modified file whose name contains the pattern.
   * `files` entries need { name, lastModified }. Office lock files (~$…)
   * are ignored. */
  function findNewestMatch(files, pattern) {
    var p = normKey(pattern);
    var best = null;
    (files || []).forEach(function (f) {
      if (/^~\$/.test(f.name)) return;
      if (p && normKey(f.name).indexOf(p) === -1) return;
      if (!best || f.lastModified > best.lastModified) best = f;
    });
    return best;
  }

  /* The stable part of a filename, so a level pointed at
   * "Sec 1 Allocation_14 Jan.xlsx" can still recognise
   * "Sec 1 Allocation_5 Aug.xlsx" as the same list under a new name.
   * Deliberately conservative: only trailing parentheticals and
   * day+month stamps are dropped, never bare numbers (which are often
   * years or cohorts that belong to the name). */
  function derivePattern(filename) {
    var base = norm(filename).replace(/\.(xlsx|xlsm|xlsb|xls|csv)$/i, '');
    base = base.replace(/\s*\([^)]*\)\s*$/, '');
    base = base.replace(
      /[\s_.\-]*(?:updated\s*)?\d{1,2}\s*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*\d{2,4})?$/i, '');
    return base.replace(/[\s_.\-]+$/, '').trim();
  }

  function findByName(files, name) {
    var want = normKey(name);
    if (!want) return null;
    var hit = null;
    (files || []).forEach(function (f) {
      if (!/^~\$/.test(f.name) && normKey(f.name) === want) hit = f;
    });
    return hit;
  }

  /* Work out what a level's chosen source file is doing right now.
   *   status 'none'      no file chosen yet
   *          'current'   chosen file present, unchanged since last import
   *          'stale'     chosen file present and modified since last import
   *          'renamed'   chosen file present, but a newer similarly-named
   *                      file exists (the office saved under a new name)
   *          'missing-alt' chosen file gone, a similarly-named one exists
   *          'missing'   nothing in the folder matches
   * `file` is the file to import from, `alt` a suggested replacement. */
  function resolveSource(files, source) {
    var pattern = norm(source.pattern) || derivePattern(source.file || '');
    var chosen = findByName(files, source.file);
    var newest = pattern ? findNewestMatch(files, pattern) : null;
    var lastMs = source.lastImported ? new Date(source.lastImported).getTime() : 0;
    if (isNaN(lastMs)) lastMs = 0;

    // Sources saved before files were chosen explicitly only have a pattern.
    if (!norm(source.file) && newest) chosen = newest;

    if (!chosen) {
      if (!norm(source.file) && !pattern) return { status: 'none', file: null, alt: null };
      return newest ? { status: 'missing-alt', file: null, alt: newest }
                    : { status: 'missing', file: null, alt: null };
    }
    var alt = (newest && normKey(newest.name) !== normKey(chosen.name) &&
      newest.lastModified > chosen.lastModified) ? newest : null;
    if (alt) return { status: 'renamed', file: chosen, alt: alt };
    return { status: chosen.lastModified > lastMs ? 'stale' : 'current', file: chosen, alt: null };
  }

  /* "EL G3" already names its subject; "CHINESE" under HMT does not — show
   * the key when the value doesn't already start with it. */
  function displayPair(key, value) {
    return normKey(value).indexOf(normKey(key)) === 0 ? value : key + ' ' + value;
  }

  function subjectSummary(student, keys) {
    var out = [];
    (keys || []).forEach(function (k) {
      var v = student.subjects && student.subjects[k];
      if (v) out.push(displayPair(k, v));
    });
    return out.join(' · ');
  }

  function studentSearchText(student, keys) {
    return (student.name + ' ' + student.class + ' ' + student.id + ' ' +
      student.pg + ' ' + subjectSummary(student, keys)).toLowerCase();
  }

  /* Lookup structures shared by both pages. `data` is a model or NAMELIST_DATA. */
  function buildIndexes(data) {
    var studentsById = new Map();
    data.students.forEach(function (s) { studentsById.set(s.id, s); });
    var groupsByCode = new Map();
    data.groups.forEach(function (g) { groupsByCode.set(g.code, g); });

    var membersByGroup = new Map();
    var groupsByStudent = new Map();
    data.memberships.forEach(function (m) {
      var s = studentsById.get(m.studentId);
      var g = groupsByCode.get(m.groupCode);
      if (!s || !g) return;
      if (!membersByGroup.has(g.code)) membersByGroup.set(g.code, []);
      membersByGroup.get(g.code).push(s);
      if (!groupsByStudent.has(s.id)) groupsByStudent.set(s.id, []);
      groupsByStudent.get(s.id).push(g);
    });
    membersByGroup.forEach(function (list) { list.sort(byClassThenName); });

    var groupsByTeacher = new Map();
    data.groups.forEach(function (g) {
      var t = norm(g.teacher);
      if (!t) return;
      if (!groupsByTeacher.has(t)) groupsByTeacher.set(t, []);
      groupsByTeacher.get(t).push(g);
    });
    groupsByTeacher.forEach(function (list) {
      list.sort(function (a, b) {
        return a.subject.localeCompare(b.subject) || a.name.localeCompare(b.name);
      });
    });
    var teachers = Array.from(groupsByTeacher.keys()).sort(function (a, b) { return a.localeCompare(b); });

    return {
      studentsById: studentsById,
      groupsByCode: groupsByCode,
      membersByGroup: membersByGroup,
      groupsByStudent: groupsByStudent,
      groupsByTeacher: groupsByTeacher,
      teachers: teachers,
    };
  }

  globalThis.NamelistSchema = {
    ORIGIN_FILE: ORIGIN_FILE,
    ORIGIN_ADDED: ORIGIN_ADDED,
    nextFreeId: nextFreeId,
    STUDENT_HEADERS: STUDENT_HEADERS,
    GROUP_HEADERS: GROUP_HEADERS,
    MEMBERSHIP_HEADERS: MEMBERSHIP_HEADERS,
    STUDENT_FIELDS: STUDENT_FIELDS,
    GROUP_FIELDS: GROUP_FIELDS,
    MEMBERSHIP_FIELDS: MEMBERSHIP_FIELDS,
    norm: norm,
    normKey: normKey,
    emptyModel: emptyModel,
    mapHeaders: mapHeaders,
    sheetRows: sheetRows,
    workbookToModel: workbookToModel,
    modelToWorkbook: modelToWorkbook,
    modelToDataJs: modelToDataJs,
    validateModel: validateModel,
    buildIndexes: buildIndexes,
    byClassThenName: byClassThenName,
    cmp: cmp,
    detectHeaderRow: detectHeaderRow,
    importStudents: importStudents,
    displayPair: displayPair,
    subjectSummary: subjectSummary,
    studentSearchText: studentSearchText,
    applyLevelUpdate: applyLevelUpdate,
    findNewestMatch: findNewestMatch,
    derivePattern: derivePattern,
    findByName: findByName,
    resolveSource: resolveSource,
    groupHasRule: groupHasRule,
    matchesRule: matchesRule,
    autoFillGroup: autoFillGroup,
  };
})();
