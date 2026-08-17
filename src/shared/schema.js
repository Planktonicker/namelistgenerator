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

  var STUDENT_HEADERS = ['StudentID', 'Name', 'Class', 'Level', 'Gender', 'PG', 'Origin'];
  var GROUP_HEADERS = ['GroupCode', 'GroupName', 'Subject', 'Teachers', 'Level',
    'AutoMatch', 'AutoLevel', 'AutoPG', 'AutoClasses'];
  var MEMBERSHIP_HEADERS = ['StudentID', 'GroupCode'];
  var SOURCE_HEADERS = ['Level', 'SourceFile', 'FilePattern', 'LastFile', 'LastImported', 'Mapping'];

  var STUDENT_FIELDS = {
    id: ['studentid', 'id', 'studentno', 'indexno', 'regno', 'nric'],
    name: ['name', 'studentname', 'fullname'],
    class: ['class', 'classname', 'formclass', 'form', 'formclassname'],
    level: ['level', 'yearlevel', 'year'],
    gender: ['gender', 'sex'],
    pg: ['pg', 'postinggroup', 'stream'],
    origin: ['origin'],
  };

  /* Only used when mapping a raw school file: a register number is a way to
   * build a stable id, not something the app stores on the student. */
  var IMPORT_FIELDS = Object.keys(STUDENT_FIELDS).reduce(function (o, k) {
    o[k] = STUDENT_FIELDS[k];
    return o;
  }, { reg: ['reg', 'regno', 'registernumber', 'indexnumber'] });
  var GROUP_FIELDS = {
    code: ['groupcode', 'code'],
    name: ['groupname', 'group', 'name'],
    subject: ['subject'],
    teachers: ['teachers', 'teacher', 'teachername', 'tutor'],
    level: ['level'],
    autoMatch: ['automatch'],
    autoLevel: ['autolevel'],
    autoKey: ['autosubject'],      // pre-multi-criteria files
    autoValue: ['autovalue'],
    autoPg: ['autopg'],
    autoClasses: ['autoclasses'],
  };

  /* Several teachers can share one teaching group (the school's setup grid
   * ticks any number of them per Level/Subject/PG/SG row), so a group holds a
   * list. Stored in one cell separated by " ; ". */
  var TEACHER_SEP = ' ; ';

  function parseTeachers(value) {
    if (Array.isArray(value)) value = value.join(';');
    return norm(value).split(';')
      .map(function (t) { return norm(t); })
      .filter(function (t, i, all) { return t && all.indexOf(t) === i; });
  }

  function teacherNames(group) {
    return Array.isArray(group.teachers) ? group.teachers : parseTeachers(group.teachers);
  }

  function teacherLabel(group) {
    return teacherNames(group).join(TEACHER_SEP);
  }
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
    mapping: ['mapping'],
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

  /* Match a header row against field aliases; returns { field: columnIndex }.
   * Exact alias matches win. With `fuzzy`, a header that merely STARTS with an
   * alias is accepted as a fallback, which is what recognises the year-stamped
   * headings schools use ("Class 2026"). Never used for the app's own sheets,
   * where headers are known exactly. */
  function mapHeaders(headerRow, fields, fuzzy) {
    var keys = headerRow.map(normKey);
    var idx = {};
    var taken = {};
    Object.keys(fields).forEach(function (field) {
      for (var a = 0; a < fields[field].length; a++) {
        var at = keys.indexOf(fields[field][a]);
        if (at !== -1 && !taken[at]) { idx[field] = at; taken[at] = true; return; }
      }
    });
    if (!fuzzy) return idx;
    Object.keys(fields).forEach(function (field) {
      if (field in idx) return;
      for (var a = 0; a < fields[field].length; a++) {
        var alias = fields[field][a];
        for (var i = 0; i < keys.length; i++) {
          if (!taken[i] && keys[i] && keys[i].indexOf(alias) === 0) {
            idx[field] = i; taken[i] = true; return;
          }
        }
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
      var rec = { id: '', name: '', class: '', level: '', gender: '', pg: '', origin: '', subjects: {} };
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
    if (groups) {
      model.groups = readTable(groups, GROUP_FIELDS, ['code'], 'Groups', warnings);
      model.groups.forEach(function (g) {
        g.teachers = parseTeachers(g.teachers);
        // Fold a pre-multi-criteria rule into the criteria list and drop the
        // old columns, so the in-memory shape has exactly one representation.
        g.autoMatch = matchersToString(matchers(g));
        delete g.autoKey;
        delete g.autoValue;
      });
    } else warnings.push('Sheet "Groups" not found.');
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
      return [s.id, s.name, s.class, s.level, s.gender, s.pg, s.origin || ORIGIN_FILE]
        .concat(keys.map(function (k) { return (s.subjects && s.subjects[k]) || ''; }));
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 5 }, { wch: 8 }]
      .concat(keys.map(function () { return { wch: 12 }; }));
    X.utils.book_append_sheet(wb, ws, 'Students');

    ws = X.utils.aoa_to_sheet([GROUP_HEADERS].concat(model.groups.map(function (g) {
      return [g.code, g.name, g.subject, teacherLabel(g), g.level,
        matchersToString(matchers(g)), g.autoLevel, g.autoPg, g.autoClasses];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 34 }, { wch: 14 },
      { wch: 40 }, { wch: 14 }, { wch: 8 }, { wch: 14 }];
    X.utils.book_append_sheet(wb, ws, 'Groups');

    ws = X.utils.aoa_to_sheet([MEMBERSHIP_HEADERS].concat(model.memberships.map(function (m) {
      return [m.studentId, m.groupCode];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, ws, 'Memberships');

    ws = X.utils.aoa_to_sheet([SOURCE_HEADERS].concat((model.sources || []).map(function (s) {
      return [s.level, s.file, s.pattern, s.lastFile, s.lastImported, s.mapping];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 42 }, { wch: 30 }, { wch: 42 }, { wch: 22 }, { wch: 60 }];
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
      if (!teacherNames(g).length) warnings.push('Group "' + g.code + '" has no teacher assigned.');
    });
    var seen = {};
    var placed = {};
    model.memberships.forEach(function (m) {
      if (!studentIds[m.studentId]) warnings.push('Membership refers to unknown StudentID "' + m.studentId + '".');
      if (!groupCodes[m.groupCode]) warnings.push('Membership refers to unknown GroupCode "' + m.groupCode + '".');
      var key = m.studentId + ' ' + m.groupCode;
      if (seen[key]) warnings.push('Duplicate membership: student "' + m.studentId + '" in group "' + m.groupCode + '".');
      seen[key] = true;
      placed[m.studentId] = true;
    });

    /* Two records for one person: the office spelling a name differently from
     * the admin, in a way the importer's matcher did not catch. Cheap to spot
     * afterwards, and merging is one click. */
    var byToken = {};
    model.students.forEach(function (s) {
      var key = nameTokens(s.name).join(' ');
      if (!key) return;
      (byToken[key] = byToken[key] || []).push(s);
    });
    Object.keys(byToken).forEach(function (key) {
      var group = byToken[key];
      if (group.length < 2) return;
      warnings.push('Possible duplicate: ' + group.map(function (s) {
        return s.name + ' (' + (s.class || 'no class') + ', ' + s.id + ')';
      }).join(' and ') + ' — merge them from the Students tab if they are the same person.');
    });

    /* A student in no class at all shows up on nobody's namelist — exactly
     * the silent gap a blank cell in the source file produces. Only worth
     * saying once there are classes to be in. */
    if (model.groups.length) {
      var orphans = model.students.filter(function (s) { return !placed[s.id]; });
      if (orphans.length) {
        warnings.push(orphans.length + ' student' + (orphans.length === 1 ? ' is' : 's are') +
          ' not in any class: ' +
          orphans.slice(0, 8).map(function (s) { return s.name + ' (' + (s.class || 'no class') + ')'; }).join(', ') +
          (orphans.length > 8 ? ', …' : ''));
      }
    }
    return warnings;
  }

  function cmp(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  /* A group's level: the one set on the group, else whichever level its
   * members mostly belong to (so groups built before levels existed still
   * file themselves correctly on the teacher page). */
  function groupLevel(group, members) {
    var own = norm(group.level);
    if (own) return own;
    var tally = {};
    (members || []).forEach(function (s) {
      var l = norm(s.level);
      if (l) tally[l] = (tally[l] || 0) + 1;
    });
    var best = '', bestN = 0;
    Object.keys(tally).forEach(function (l) {
      if (tally[l] > bestN) { bestN = tally[l]; best = l; }
    });
    return best;
  }

  /* Group a teacher's groups by level, in level order, for the
   * "which classes do I teach in each level" view. */
  function groupsByLevelFor(indexes, teacher) {
    var groups = indexes.groupsByTeacher.get(teacher) || [];
    var buckets = new Map();
    groups.forEach(function (g) {
      var lvl = groupLevel(g, indexes.membersByGroup.get(g.code));
      if (!buckets.has(lvl)) buckets.set(lvl, []);
      buckets.get(lvl).push(g);
    });
    return Array.from(buckets.keys())
      .sort(function (a, b) {
        if (!a) return 1;          // ungraded groups last
        if (!b) return -1;
        return cmp(a, b);
      })
      .map(function (lvl) { return { level: lvl, groups: buckets.get(lvl) }; });
  }

  function byClassThenName(a, b) {
    return cmp(a.class, b.class) || cmp(a.name, b.name) || cmp(a.id, b.id);
  }

  /* ---- raw-document import ------------------------------------------- */

  /* ---- positional subject slots -------------------------------------
   * Ministry-style allocation files put the subjects in generic
   * "Subject 1 … Subject 20" columns, so the subject's identity is inside
   * the cell: "English Language - G2 - K200" = subject, band, class code.
   * The code is the teaching class every student in that cell belongs to. */

  function isSlotHeader(h) {
    return /^sub(?:ject)?\s*\d+$/i.test(norm(h));
  }

  function slotColumns(headers) {
    var out = [];
    (headers || []).forEach(function (h, i) { if (isSlotHeader(h)) out.push(i); });
    return out;
  }

  function hasSubjectSlots(headers) {
    return slotColumns(headers).length > 0;
  }

  /* Slot cells come in two dialects:
   *   coded — "English Language - G2 - K200" (ministry allocation files)
   *   plain — "Sci CB G3", "DT"              (the school's own grouping lists)
   * Which one a file speaks is decided by sampling it, because the coded form
   * lets us reject the stray notes admins park in spare slot columns, while
   * the plain form must accept a bare "DT". */
  function slotDialect(rows, slotCols, headerRow) {
    var coded = 0, total = 0;
    for (var r = (headerRow || 0) + 1; r < rows.length; r++) {
      (slotCols || []).forEach(function (c) {
        var v = norm((rows[r] || [])[c]);
        if (!v) return;
        total++;
        if (/ - /.test(v)) coded++;
      });
      if (total > 200) break;
    }
    return total && coded >= total / 2 ? 'coded' : 'plain';
  }

  /* A cell in a slot column -> { subject, band, code, value }, or null if it
   * is not an allocation at all. */
  function parseAllocation(cell, dialect) {
    var raw = norm(cell);
    if (!raw) return null;
    if (dialect === 'plain') {
      // Free-text notes rather than a subject: questions, sentences.
      if (/[?]/.test(raw) || raw.length > 40 || raw.split(/\s+/).length > 5) return null;
      var m = /^(.*?)[\s-]*\b(G[123])$/i.exec(raw);
      var subject = norm(m ? m[1] : raw);
      var band = m ? m[2].toUpperCase() : '';
      if (!subject) return null;
      return { subject: subject, band: band, code: '', value: band || subject };
    }
    var parts = raw.split(' - ').map(function (p) { return norm(p); });
    var code = '';
    var band = '';
    if (parts.length > 1 && /^[A-Z]{1,3}\d{2,5}$/i.test(parts[parts.length - 1])) code = parts.pop();
    if (parts.length > 1 && /^G\d$/i.test(parts[parts.length - 1])) band = parts.pop();
    var subj = parts.join(' - ');
    if (!subj || (!band && !code)) return null;
    return {
      subject: subj, band: band, code: code,
      value: [band, code].filter(Boolean).join(' - '),
    };
  }

  /* Every distinct allocation across the students, as ready-made classes to
   * tag teachers onto. Codeless allocations fall back to a name+band slug. */
  function discoverClasses(students, level) {
    var found = new Map();
    (students || []).forEach(function (s) {
      Object.keys(s.subjects || {}).forEach(function (subject) {
        var value = norm(s.subjects[subject]);
        if (!value) return;
        var bits = value.split(' - ');
        var band = /^G\d$/i.test(bits[0]) ? bits[0] : '';
        var code = bits.length > 1 ? bits[bits.length - 1] : (band ? '' : bits[0]);
        var key = subject + '|' + value;
        if (found.has(key)) { found.get(key).n++; return; }
        found.set(key, {
          code: code || normKey(subject + '-' + band).toUpperCase().slice(0, 16),
          name: subject + (band ? ' - ' + band : ''),
          subject: subject,
          teachers: [],
          level: norm(level),
          autoMatch: subject + '=' + value,
          autoLevel: '',
          autoPg: '',
          autoClasses: '',
          n: 1,
        });
      });
    });
    var list = Array.from(found.values());
    // Two subjects could share a slug; keep codes unique.
    var used = {};
    list.forEach(function (g) {
      var base = g.code, i = 2;
      while (used[normKey(g.code)]) g.code = base + '-' + (i++);
      used[normKey(g.code)] = true;
    });
    return list.sort(function (a, b) { return cmp(a.subject, b.subject) || cmp(a.name, b.name); });
  }

  /* ---- per-level column mapping -------------------------------------
   * School files drift: a column gets renamed, moved, or added, and each
   * level's file is laid out differently in the first place. The mapping a
   * level was imported with is therefore remembered, and remembered by
   * COLUMN HEADER rather than position — so a column that moves is a
   * non-event, and only a genuine rename needs the admin's attention.
   *
   *   { sheet, headerRow, cols: {name, class, ...}, subjects: [], slots: [],
   *     rename: { "SCII": "SCI" }, dialect }
   *
   * Header names are stored; indexes are resolved against the file each time.
   */
  function proposeMapping(wb, saved) {
    var sheetName = '';
    var rows = null;
    if (saved && saved.sheet) {
      var ws = findSheet(wb, saved.sheet);
      if (ws) { sheetName = saved.sheet; rows = sheetRows(ws); }
    }
    if (!rows) {
      // Pick whichever sheet looks most like a student list.
      var bestScore = -1;
      wb.SheetNames.forEach(function (name) {
        var r = sheetRows(wb.Sheets[name]);
        var hr = detectHeaderRow(r);
        var m = mapHeaders(r[hr] || [], IMPORT_FIELDS, true);
        var score = Object.keys(m).length + ('name' in m ? 2 : 0) +
          Math.min(Math.max(r.length - hr - 1, 0), 50) / 100;
        if (score > bestScore) { bestScore = score; sheetName = name; rows = r; }
      });
    }
    rows = rows || [];
    var headerRow = saved && saved.headerRow != null && rows[saved.headerRow] &&
      mapHeaders(rows[saved.headerRow], IMPORT_FIELDS, true).name != null
      ? saved.headerRow : detectHeaderRow(rows);
    var headers = (rows[headerRow] || []).map(norm);

    var guess = mapHeaders(headers, IMPORT_FIELDS, true);
    var cols = {};
    Object.keys(IMPORT_FIELDS).forEach(function (f) {
      cols[f] = f in guess ? headers[guess[f]] : '';
    });
    var missing = [];
    if (saved && saved.cols) {
      // Prefer what the admin settled on, as long as that column still exists.
      Object.keys(saved.cols).forEach(function (f) {
        var want = norm(saved.cols[f]);
        if (!want) { cols[f] = ''; return; }
        if (headers.some(function (h) { return normKey(h) === normKey(want); })) cols[f] = want;
        else missing.push(want);
      });
    }

    var used = {};
    Object.keys(cols).forEach(function (f) { if (cols[f]) used[normKey(cols[f])] = true; });

    var slots = [];
    var subjects = [];
    headers.forEach(function (h) {
      if (!h || used[normKey(h)]) return;
      if (isSlotHeader(h)) slots.push(h);
      else if (!/psle|remark|^no$|^s\/?n$|^serial/i.test(h)) subjects.push(h);
    });
    var added = [];
    if (saved && saved.subjects) {
      var keep = {};
      saved.subjects.forEach(function (x) { keep[normKey(x)] = true; });
      (saved.ignored || []).forEach(function (x) { keep[normKey(x)] = false; });
      added = subjects.filter(function (h) { return !(normKey(h) in keep); });
      subjects = subjects.filter(function (h) {
        return keep[normKey(h)] !== false && (keep[normKey(h)] || added.indexOf(h) !== -1);
      });
      saved.subjects.forEach(function (x) {
        if (!headers.some(function (h) { return normKey(h) === normKey(x); })) missing.push(x);
      });
    }

    return {
      sheet: sheetName,
      headerRow: headerRow,
      headers: headers,
      rows: rows,
      cols: cols,
      subjects: subjects,
      slots: slots,
      rename: (saved && saved.rename) || {},
      dialect: slotDialect(rows, slots.map(function (h) { return headers.indexOf(h); }), headerRow),
      newColumns: added,          // columns the file has that the mapping did not
      missingColumns: missing,    // columns the mapping expects that the file lost
    };
  }

  /* The durable part of a proposal, for storing on the level. */
  function mappingToJson(m) {
    return JSON.stringify({
      sheet: m.sheet,
      headerRow: m.headerRow,
      cols: m.cols,
      subjects: m.subjects,
      ignored: (m.headers || []).filter(function (h) {
        return h && !isSlotHeader(h) && m.subjects.indexOf(h) === -1 &&
          !Object.keys(m.cols).some(function (f) { return normKey(m.cols[f]) === normKey(h); });
      }),
      rename: m.rename,
    });
  }

  /* null means "this level has never been mapped", which is what makes the
   * first import stop and ask. */
  function mappingFromJson(text) {
    var t = norm(text);
    if (!t) return null;
    try {
      var o = JSON.parse(t);
      return o && typeof o === 'object' && o.cols ? o : null;
    } catch (e) { return null; }
  }

  /* Turn a proposal into the argument importStudents wants. */
  function mappingToImport(m) {
    function at(header) {
      var want = normKey(header);
      for (var i = 0; i < m.headers.length; i++) if (normKey(m.headers[i]) === want) return i;
      return null;
    }
    var cols = {};
    Object.keys(m.cols).forEach(function (f) { cols[f] = m.cols[f] ? at(m.cols[f]) : null; });
    return {
      headerRow: m.headerRow,
      cols: cols,
      subjectCols: m.subjects.map(function (h) {
        return { index: at(h), header: norm(m.rename[h] || h) };
      }).filter(function (c) { return c.index != null; }),
      slotCols: m.slots.map(at).filter(function (i) { return i != null; }),
      dialect: m.dialect,
    };
  }

  /* Find the most plausible header row in the first 15 rows of a sheet
   * (real documents often carry titles/dates above the actual table). */
  function detectHeaderRow(rows) {
    var best = 0;
    var bestScore = -1;
    var limit = Math.min(rows.length, 15);
    for (var r = 0; r < limit; r++) {
      var m = mapHeaders(rows[r] || [], IMPORT_FIELDS, true);
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
        // A register number makes a stable id that survives row reordering.
        var reg = cell(row, 'reg');
        if (reg) {
          id = (cls || 'S') + '-' + (reg.length < 2 ? '0' + reg : reg);
        } else {
          var base = cls || 'S';
          counters[base] = (counters[base] || 0) + 1;
          id = base + '-' + (counters[base] < 10 ? '0' : '') + counters[base];
        }
      }
      if (usedIds[id]) { warnings.push('Row ' + (r + 1) + ': duplicate ID "' + id + '" — skipped.'); continue; }
      usedIds[id] = true;
      var subjects = {};
      (mapping.subjectCols || []).forEach(function (sc) {
        var v = norm(row[sc.index]);
        if (v) subjects[norm(sc.header)] = v;
      });
      // Positional slots: the subject names itself inside the cell.
      (mapping.slotCols || []).forEach(function (ci) {
        var a = parseAllocation(row[ci], mapping.dialect);
        if (!a) return;
        var key = a.subject;
        if (subjects[key] && subjects[key] !== a.value) {
          var n = 2;
          while (subjects[key + ' (' + n + ')']) n++;
          key = key + ' (' + n + ')';       // same subject twice: keep both
        }
        subjects[key] = a.value;
      });
      students.push({
        id: id, name: name, class: cls,
        level: cell(row, 'level'),
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
  /* Names for comparison: lowercase word tokens, order-independent. Lets
   * "Tan Wei Ming" recognise "Wei Ming Tan" and "Tan Wei Ming (Nathan)". */
  function nameTokens(name) {
    return norm(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .filter(function (t, i, a) { return t && a.indexOf(t) === i; })
      .sort();
  }

  function tokensOverlap(a, b) {
    if (a.length < 2 || b.length < 2) return false;
    var small = a.length <= b.length ? a : b;
    var big = a.length <= b.length ? b : a;
    var shared = small.filter(function (t) { return big.indexOf(t) !== -1; }).length;
    return shared === small.length;   // every token of the shorter name is present
  }

  function applyLevelUpdate(model, imported, importedKeys) {
    importedKeys = importedKeys || [];
    var classSet = {};
    var levelSet = {};
    imported.forEach(function (s) {
      if (s.class) classSet[s.class] = true;
      if (s.level) levelSet[normKey(s.level)] = true;
    });

    /* Students of the classes this file covers, PLUS anyone entered in the app
     * for this level whatever class they were put in — otherwise a student the
     * admin added under a different (or blank) class would be added a second
     * time when the office finally lists them. */
    var pool = model.students.filter(function (s) {
      if (classSet[s.class]) return true;
      return s.origin === ORIGIN_ADDED &&
        (!Object.keys(levelSet).length || levelSet[normKey(s.level)] || !norm(s.level));
    });
    var byNameClass = {};
    var byName = {};
    pool.forEach(function (s) {
      var nk = normKey(s.name);
      byNameClass[nk + '|' + s.class] = s;
      byName[nk] = nk in byName ? null : s;   // null marks an ambiguous name
    });
    var addedPool = pool.filter(function (s) { return s.origin === ORIGIN_ADDED; });

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
    var updated = 0, added = 0, adopted = 0;
    var addedIds = [];
    var adoptedLabels = [];
    imported.forEach(function (imp) {
      var nk = normKey(imp.name);
      var m = byNameClass[nk + '|' + imp.class] || byName[nk] || null;
      if (m && matched[m.id]) m = null;
      if (!m) {
        // Last resort, and only against students entered in the app: the same
        // person written slightly differently by the office.
        var toks = nameTokens(imp.name);
        var near = addedPool.filter(function (s) {
          return !matched[s.id] && tokensOverlap(toks, nameTokens(s.name));
        });
        if (near.length === 1) {
          m = near[0];
          adopted++;
          adoptedLabels.push(m.name + (normKey(m.name) === nk ? '' : ' → ' + imp.name));
        }
      }
      if (m) {
        matched[m.id] = true;
        m.name = imp.name;
        m.origin = ORIGIN_FILE;   // adopted: the school's file now lists them
        if (imp.class) m.class = imp.class;
        if (imp.level) m.level = imp.level;
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
          id: newId, name: imp.name, class: imp.class, level: imp.level,
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
      adopted: adopted,
      adoptedLabels: adoptedLabels,
      addedIds: addedIds,
      keptAddedIds: keptAdded.map(function (s) { return s.id; }),
      missingIds: missing.map(function (s) { return s.id; }),
      missingLabels: missing.map(function (s) { return s.name + ' (' + s.class + ')'; }),
    };
  }

  /* Fold `loserId` into `keeperId`: memberships move across, blank fields on
   * the keeper are filled from the loser, and the loser is removed. Used when
   * the same person was entered twice under slightly different names. */
  function mergeStudents(model, keeperId, loserId) {
    var keeper = null, loser = null;
    model.students.forEach(function (s) {
      if (s.id === keeperId) keeper = s;
      if (s.id === loserId) loser = s;
    });
    if (!keeper || !loser || keeper === loser) return null;
    ['class', 'level', 'gender', 'pg'].forEach(function (f) {
      if (!norm(keeper[f]) && norm(loser[f])) keeper[f] = loser[f];
    });
    keeper.subjects = keeper.subjects || {};
    Object.keys(loser.subjects || {}).forEach(function (k) {
      if (!norm(keeper.subjects[k])) keeper.subjects[k] = loser.subjects[k];
    });
    var have = {};
    model.memberships.forEach(function (m) {
      if (m.studentId === keeperId) have[m.groupCode] = true;
    });
    var moved = 0;
    model.memberships.forEach(function (m) {
      if (m.studentId !== loserId) return;
      if (have[m.groupCode]) { m.studentId = null; return; }
      m.studentId = keeperId;
      have[m.groupCode] = true;
      moved++;
    });
    model.memberships = model.memberships.filter(function (m) { return m.studentId; });
    model.students = model.students.filter(function (s) { return s.id !== loserId; });
    return { keeper: keeper, moved: moved };
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

  /* A group's rule mirrors the school's setup grid: Level + PG + a class
   * filter + any number of column criteria. Reproducing a namelist query
   * such as "Level 3, PG3, SG = 3 A, Subject = SS/Geo" needs two column
   * criteria at once, so they are held as a list, stored in one cell as
   * "SG=3 A; History/Geog/HEM=SS/Geo". A criterion with no value means
   * "has anything in that column". Everything filled in must hold; blanks
   * mean "any". The class filter takes comma-separated names or prefixes
   * ("1R" matches 1R1…1R6). */
  function matchers(group) {
    var out = [];
    var seen = {};
    function add(key, value) {
      key = norm(key);
      if (!key || seen[normKey(key)]) return;
      seen[normKey(key)] = true;
      out.push({ key: key, value: norm(value) });
    }
    norm(group.autoMatch).split(';').forEach(function (part) {
      if (!norm(part)) return;
      var at = part.indexOf('=');
      if (at === -1) add(part, '');
      else add(part.slice(0, at), part.slice(at + 1));
    });
    add(group.autoKey, group.autoValue);   // pre-multi-criteria files
    return out;
  }

  function matchersToString(list) {
    return (list || []).filter(function (m) { return norm(m.key); })
      .map(function (m) { return norm(m.key) + '=' + norm(m.value); })
      .join('; ');
  }

  function groupHasRule(group) {
    return !!(matchers(group).length || norm(group.autoClasses) ||
      norm(group.autoPg) || norm(group.autoLevel));
  }

  function matchesRule(student, group) {
    if (!groupHasRule(group)) return false;
    var level = norm(group.autoLevel);
    if (level && normKey(student.level) !== normKey(level)) return false;
    var pg = norm(group.autoPg);
    if (pg && normKey(student.pg) !== normKey(pg)) return false;
    var classes = norm(group.autoClasses);
    if (classes) {
      var sc = normKey(student.class);
      var ok = classes.split(/[,;]+/).some(function (t) {
        t = normKey(t);
        return t && sc.indexOf(t) === 0;
      });
      if (!ok) return false;
    }
    return matchers(group).every(function (m) {
      var v = student.subjects ? norm(student.subjects[m.key]) : '';
      if (!v) return false;
      return !m.value || normKey(v) === normKey(m.value);
    });
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
      teacherNames(g).forEach(function (t) {
        if (!groupsByTeacher.has(t)) groupsByTeacher.set(t, []);
        groupsByTeacher.get(t).push(g);
      });
    });
    groupsByTeacher.forEach(function (list) {
      list.sort(function (a, b) {
        return cmp(a.level, b.level) || cmp(a.subject, b.subject) || cmp(a.name, b.name);
      });
    });
    var teachers = Array.from(groupsByTeacher.keys()).sort(cmp);

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
    mergeStudents: mergeStudents,
    STUDENT_HEADERS: STUDENT_HEADERS,
    GROUP_HEADERS: GROUP_HEADERS,
    MEMBERSHIP_HEADERS: MEMBERSHIP_HEADERS,
    STUDENT_FIELDS: STUDENT_FIELDS,
    IMPORT_FIELDS: IMPORT_FIELDS,
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
    nameTokens: nameTokens,
    tokensOverlap: tokensOverlap,
    detectHeaderRow: detectHeaderRow,
    importStudents: importStudents,
    displayPair: displayPair,
    subjectSummary: subjectSummary,
    studentSearchText: studentSearchText,
    applyLevelUpdate: applyLevelUpdate,
    findNewestMatch: findNewestMatch,
    isSlotHeader: isSlotHeader,
    slotColumns: slotColumns,
    slotDialect: slotDialect,
    proposeMapping: proposeMapping,
    mappingToJson: mappingToJson,
    mappingFromJson: mappingFromJson,
    mappingToImport: mappingToImport,
    hasSubjectSlots: hasSubjectSlots,
    parseAllocation: parseAllocation,
    discoverClasses: discoverClasses,
    matchers: matchers,
    matchersToString: matchersToString,
    derivePattern: derivePattern,
    findByName: findByName,
    resolveSource: resolveSource,
    groupHasRule: groupHasRule,
    matchesRule: matchesRule,
    autoFillGroup: autoFillGroup,
    TEACHER_SEP: TEACHER_SEP,
    parseTeachers: parseTeachers,
    teacherNames: teacherNames,
    teacherLabel: teacherLabel,
    groupLevel: groupLevel,
    groupsByLevelFor: groupsByLevelFor,
  };
})();
