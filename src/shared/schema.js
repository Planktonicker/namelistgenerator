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

  /* A student the school's file still lists but who has left. The file is
   * read-only and cannot be corrected, so the app remembers the fact instead:
   * a "left" student stays out of every class and every namelist, and stays
   * out when the level is refreshed, until the office drops them too. */
  var STATUS_LEFT = 'left';

  var STUDENT_HEADERS = ['StudentID', 'Name', 'Class', 'Level', 'Gender', 'PG', 'TG', 'SN',
    'Origin', 'SourceName', 'Status'];
  var GROUP_HEADERS = ['GroupCode', 'GroupName', 'Subject', 'Teachers', 'Level',
    'AutoMatch', 'AutoPG', 'AutoTG', 'AutoClasses'];
  var MEMBERSHIP_HEADERS = ['StudentID', 'GroupCode'];
  var TEACHER_HEADERS = ['Name'];
  var SUBJECT_HEADERS = ['Subject'];
  var SOURCE_HEADERS = ['Level', 'SourceFile', 'FilePattern', 'LastFile', 'LastImported', 'Mapping'];
  var REQUEST_HEADERS = ['RequestID', 'Made', 'Teacher', 'GroupCode', 'Action', 'StudentName',
    'StudentID', 'Reason', 'Status', 'Decided', 'Note'];

  var STUDENT_FIELDS = {
    id: ['studentid', 'id', 'studentno', 'indexno', 'regno', 'nric'],
    name: ['name', 'studentname', 'fullname'],
    class: ['class', 'classname', 'formclass', 'form', 'formclassname'],
    level: ['level', 'yearlevel', 'year'],
    gender: ['gender', 'sex'],
    pg: ['pg', 'postinggroup', 'stream'],
    /* Tutorial group and subject group are the same thing under two names:
     * the teaching group a student sits in for a subject, which need not be
     * their form class (SG1–SG6 across 1R1–1R6). */
    tg: ['tg', 'sg', 'subgroup', 'subjectgroup', 'tutorialgroup', 'tutgroup', 'subjgroup',
      'subgrp', 'subjgrp', 'sgroup'],
    /* The school's own serial number for the student, kept so a printed
     * namelist can carry the same S/N the office's list uses. */
    sn: ['sn', 'no', 'serialno', 'sno', 'runningno', 'sequenceno'],
    origin: ['origin'],
    sourceName: ['sourcename'],
    status: ['status'],
  };

  /* Only used when mapping a raw school file: a register number is a way to
   * build a stable id, not something the app stores on the student. */
  var IMPORT_FIELDS = Object.keys(STUDENT_FIELDS).reduce(function (o, k) {
    // "Status" is the app's own record of a student having left; a column of
    // that name in a school file means something else entirely.
    if (k !== 'status') o[k] = STUDENT_FIELDS[k];
    return o;
  }, { reg: ['reg', 'regno', 'registernumber', 'indexnumber'] });
  var GROUP_FIELDS = {
    code: ['groupcode', 'code'],
    name: ['groupname', 'group', 'name'],
    subject: ['subject'],
    teachers: ['teachers', 'teacher', 'teachername', 'tutor'],
    level: ['level'],
    autoMatch: ['automatch'],
    autoLevel: ['autolevel'],   // folded into level on read
    autoKey: ['autosubject'],      // pre-multi-criteria files
    autoValue: ['autovalue'],
    autoPg: ['autopg'],
    autoTg: ['autotg', 'autosg'],
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
  var REQUEST_FIELDS = {
    id: ['requestid', 'id'],
    made: ['made', 'sent', 'when'],
    teacher: ['teacher'],
    group: ['groupcode', 'group', 'class'],
    action: ['action'],
    name: ['studentname', 'name'],
    studentId: ['studentid'],
    reason: ['reason'],
    status: ['status'],
    decided: ['decided'],
    note: ['note'],
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

  /* Posting groups are 1, 2, 3 — nothing else. Files write them as "PG1",
   * "PG 2", "P.G.3" or plain "3" depending on who typed them, so every PG is
   * reduced to its number here, on the way in and on the way back out. A
   * value that is not a plain posting group (blank, "N/A", something odd) is
   * left exactly as it was rather than being mangled into a digit. */
  function normPg(v) {
    var t = norm(v);
    if (!t) return '';
    var m = /^p\.?\s*g\.?\s*[-:]?\s*(\d+)$/i.exec(t);
    if (m) return m[1];
    if (/^\d+$/.test(t)) return String(parseInt(t, 10));
    return t;
  }

  /* Tutorial/subject groups are written SG3, "SG 3", tg3, sometimes bare 3.
   * Spacing and case are noise; the label the school uses is not, so only the
   * former is normalised. */
  function normTg(v) {
    var t = norm(v).replace(/\s+/g, ' ').toUpperCase();
    // "SG 3", "sg3" and "TG-2" are one label with a number: close it up.
    var m = /^([A-Z]{1,3})\s*[-.]?\s*(\d+[A-Z]?)$/.exec(t);
    if (m) return m[1] + m[2];
    // Anything else ("2 A/BC", "1 A/CO") is the school's own code: leave it be.
    return t;
  }

  /* Does this column hold tutorial/subject groups rather than a subject? */
  function isTgHeader(h) {
    return /^(tg|sg|sub\s*group|sub\s*grp|tutorial\s*group|subject\s*group|subj\s*group)\b/i.test(norm(h));
  }

  /* "1, 2" -> ['1','2']; used for the fields the class dialog now ticks
   * several boxes into (PG and form classes). */
  function splitList(v) {
    return norm(v).split(/[,;|]+/).map(norm).filter(Boolean);
  }

  function hasLeft(student) {
    return !!student && normKey(student.status) === STATUS_LEFT;
  }

  function emptyModel() {
    return { students: [], groups: [], memberships: [], subjectKeys: [], sources: [],
      teachers: [], subjectLabels: [], requests: [] };
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
      var rec = { id: '', name: '', class: '', level: '', gender: '', pg: '', tg: '', sn: '',
        origin: '', sourceName: '', status: '', subjects: {} };
      Object.keys(STUDENT_FIELDS).forEach(function (f) {
        rec[f] = f in idx ? norm(row[idx[f]]) : '';
      });
      rec.pg = normPg(rec.pg);
      rec.tg = normTg(rec.tg);
      rec.status = normKey(rec.status) === STATUS_LEFT ? STATUS_LEFT : '';
      // Files written before the Origin column existed: assume the students
      // came from the school file (the pre-existing behaviour).
      if (rec.origin !== ORIGIN_ADDED) rec.origin = ORIGIN_FILE;
      // Blank SourceName means the displayed name is still the file's own.
      if (!rec.sourceName) rec.sourceName = rec.name;
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
        if (!norm(g.level) && norm(g.autoLevel)) g.level = g.autoLevel;
        g.autoPg = splitList(g.autoPg).map(normPg).join(', ');
        delete g.autoKey;
        delete g.autoValue;
        delete g.autoLevel;
      });
    } else warnings.push('Sheet "Groups" not found.');
    liftTutorialGroups(model);
    if (memberships) model.memberships = readTable(memberships, MEMBERSHIP_FIELDS, ['studentId', 'groupCode'], 'Memberships', warnings);
    else warnings.push('Sheet "Memberships" not found.');
    var sources = findSheet(wb, 'Sources');   // optional sheet — older files lack it
    if (sources) model.sources = readTable(sources, SOURCE_FIELDS, ['level'], 'Sources', warnings);
    var reqs = findSheet(wb, 'Requests');     // optional too
    if (reqs) {
      model.requests = readTable(reqs, REQUEST_FIELDS, ['id'], 'Requests', warnings)
        .map(function (r) {
          r.action = normKey(r.action) === 'add' ? 'add' : 'remove';
          r.status = ['done', 'dismissed'].indexOf(normKey(r.status)) !== -1 ? normKey(r.status) : 'open';
          return r;
        });
    }
    var staff = findSheet(wb, 'Teachers');
    if (staff) {
      model.teachers = readTable(staff, { name: ['name', 'teacher'] }, ['name'], 'Teachers', [])
        .map(function (r) { return r.name; });
    }
    // Any name already used on a class belongs in the roster too.
    model.groups.forEach(function (g) {
      teacherNames(g).forEach(function (t) {
        if (!model.teachers.some(function (e) { return normKey(e) === normKey(t); })) model.teachers.push(t);
      });
    });
    model.teachers.sort(cmp);

    /* Subject labels are a list of their own, so a subject typed once can be
     * picked from then on — and any label already on a class belongs in it. */
    var subjectSheet = findSheet(wb, 'Subjects');
    if (subjectSheet) {
      model.subjectLabels = readTable(subjectSheet, { name: ['subject', 'name'] }, ['name'], 'Subjects', [])
        .map(function (r) { return r.name; });
    }
    model.groups.forEach(function (g) {
      var label = norm(g.subject);
      if (label && !model.subjectLabels.some(function (e) { return normKey(e) === normKey(label); })) {
        model.subjectLabels.push(label);
      }
    });
    model.subjectLabels.sort(cmp);
    return { model: model, warnings: warnings.concat(validateModel(model)) };
  }

  /* Files written before TG/SG was a field of its own kept it as just another
   * subject column. Lift it onto the student, drop the column, and rewrite any
   * class rule that pointed at it — so an existing namelist.xlsx keeps working
   * and ends up with one representation, not two. */
  function liftTutorialGroups(model) {
    var moved = (model.subjectKeys || []).filter(isTgHeader);
    var touched = 0;
    model.students.forEach(function (s) {
      moved.forEach(function (k) {
        var v = s.subjects && s.subjects[k];
        if (v && !norm(s.tg)) { s.tg = normTg(v); touched++; }
        if (s.subjects) delete s.subjects[k];
      });
    });
    model.subjectKeys = model.subjectKeys.filter(function (k) { return !isTgHeader(k); });
    model.groups.forEach(function (g) {
      var keep = [];
      var tgs = splitList(g.autoTg);
      matchers(g).forEach(function (m) {
        if (isTgHeader(m.key)) tgs = tgs.concat(m.values);
        else keep.push(m);
      });
      g.autoMatch = matchersToString(keep);
      g.autoTg = tgs.map(normTg).filter(function (t, i, all) { return t && all.indexOf(t) === i; }).join(', ');
    });
    return touched;
  }

  function modelToWorkbook(model) {
    var X = xlsx();
    var wb = X.utils.book_new();
    var ws;

    var keys = model.subjectKeys || [];
    ws = X.utils.aoa_to_sheet([STUDENT_HEADERS.concat(keys)].concat(model.students.map(function (s) {
      return [s.id, s.name, s.class, s.level, s.gender, s.pg, s.tg, s.sn, s.origin || ORIGIN_FILE,
        s.sourceName === s.name ? '' : s.sourceName, s.status || '']
        .concat(keys.map(function (k) { return (s.subjects && s.subjects[k]) || ''; }));
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 28 }, { wch: 8 }, { wch: 6 }, { wch: 8 }, { wch: 5 },
      { wch: 6 }, { wch: 5 }, { wch: 8 }, { wch: 28 }, { wch: 8 }]
      .concat(keys.map(function () { return { wch: 12 }; }));
    X.utils.book_append_sheet(wb, ws, 'Students');

    ws = X.utils.aoa_to_sheet([GROUP_HEADERS].concat(model.groups.map(function (g) {
      return [g.code, g.name, g.subject, teacherLabel(g), g.level,
        matchersToString(matchers(g)), g.autoPg, g.autoTg, g.autoClasses];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 34 }, { wch: 14 },
      { wch: 40 }, { wch: 8 }, { wch: 10 }, { wch: 14 }];
    X.utils.book_append_sheet(wb, ws, 'Groups');

    ws = X.utils.aoa_to_sheet([MEMBERSHIP_HEADERS].concat(model.memberships.map(function (m) {
      return [m.studentId, m.groupCode];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, ws, 'Memberships');

    ws = X.utils.aoa_to_sheet([TEACHER_HEADERS].concat((model.teachers || []).map(function (t) {
      return [t];
    })));
    ws['!cols'] = [{ wch: 34 }];
    X.utils.book_append_sheet(wb, ws, 'Teachers');

    ws = X.utils.aoa_to_sheet([SUBJECT_HEADERS].concat((model.subjectLabels || []).map(function (t) {
      return [t];
    })));
    ws['!cols'] = [{ wch: 30 }];
    X.utils.book_append_sheet(wb, ws, 'Subjects');

    ws = X.utils.aoa_to_sheet([SOURCE_HEADERS].concat((model.sources || []).map(function (s) {
      return [s.level, s.file, s.pattern, s.lastFile, s.lastImported, s.mapping];
    })));
    ws['!cols'] = [{ wch: 12 }, { wch: 42 }, { wch: 30 }, { wch: 42 }, { wch: 22 }, { wch: 60 }];
    X.utils.book_append_sheet(wb, ws, 'Sources');

    ws = X.utils.aoa_to_sheet([REQUEST_HEADERS].concat((model.requests || []).map(function (r) {
      return [r.id, r.made, r.teacher, r.group, r.action, r.name, r.studentId, r.reason,
        r.status || 'open', r.decided, r.note];
    })));
    ws['!cols'] = [{ wch: 14 }, { wch: 22 }, { wch: 24 }, { wch: 16 }, { wch: 8 }, { wch: 28 },
      { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 22 }, { wch: 30 }];
    X.utils.book_append_sheet(wb, ws, 'Requests');

    return wb;
  }

  function modelToDataJs(model, savedAtIso) {
    var data = {
      savedAt: savedAtIso,
      students: model.students,
      groups: model.groups,
      memberships: model.memberships,
      subjectKeys: model.subjectKeys || [],
      /* Only what a teacher needs to see the fate of their own suggestions —
       * enough to say "accepted" or "not taken up" next to what they sent. */
      requests: (model.requests || []).map(function (r) {
        return { id: r.id, teacher: r.teacher, group: r.group, action: r.action,
          name: r.name, status: r.status || 'open', note: r.note || '' };
      }),
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
    var byBucket = {};
    model.students.forEach(function (s) {
      var bucket = normKey(s.class) || normKey(s.level) || '*';
      (byBucket[bucket] = byBucket[bucket] || []).push(s);
    });
    var reported = {};
    Object.keys(byBucket).forEach(function (bucket) {
      var list = byBucket[bucket];
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          // One name containing the other ("Nur Aisyah" / "Nur Aisyah Bte
          // Rahman") is usually the office rewriting a name, not two people.
          if (!tokensOverlap(nameTokens(list[i].name), nameTokens(list[j].name))) continue;
          var key = [list[i].id, list[j].id].sort().join('|');
          if (reported[key]) continue;
          reported[key] = true;
          warnings.push('Possible duplicate: ' + list[i].name + ' (' + list[i].id + ') and ' +
            list[j].name + ' (' + list[j].id + ') in ' + (list[i].class || 'no class') +
            ' — select both in the Students tab and press Merge if they are one person.');
        }
      }
    });

    /* A student in no class at all shows up on nobody's namelist — exactly
     * the silent gap a blank cell in the source file produces. Only worth
     * saying once there are classes to be in. */
    if (model.groups.length) {
      var orphans = model.students.filter(function (s) { return !placed[s.id] && !hasLeft(s); });
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
      /* The value carries the subject as well as the band. These columns are
       * positional — POA can sit under Sub 5 for one student and Sub 7 for the
       * next — so a bare "G2" would collide with every other subject's G2 and
       * read as nothing on its own. */
      return {
        subject: subject, band: band, code: '',
        value: band ? subject + ' ' + band : subject,
      };
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

  /* ---- subject-based banding -------------------------------------------
   * Two habits collide in the school's files. Subjects are written however the
   * teacher writes them ("SS/Hist", "SSHist", "SS Hist"), and the band is only
   * spelt out when it differs from the student's posting group:
   *
   *   PG 3, "SS/Hist"      -> History at G3 (the band is the posting group)
   *   PG 2, "SS/Hist G3"   -> History at G3, taken above their posting group
   *   PG 2, "SS/Hist"      -> History at G2
   *
   * So an allocation is read as a subject plus an EFFECTIVE band: the band in
   * the cell if there is one, the posting group's band if there is not. Both
   * students above land in the same G3 class, whichever way it was typed.
   *
   * Ministry-coded cells ("G2 - K200") name the class outright and are left
   * exactly as they are — there is nothing to infer. */
  function pgBand(pg) {
    var p = normPg(pg);
    return /^[1-3]$/.test(p) ? 'G' + p : '';
  }

  function isCodedValue(value) {
    return /\b[A-Za-z]{1,3}\d{2,5}\b/.test(norm(value));   // K200, S1234
  }

  /* { subject, band } for a plainly written allocation, or null when the cell
   * is a coded one that should be matched verbatim. */
  function sbbParts(value) {
    var raw = norm(value);
    if (!raw || isCodedValue(raw)) return null;
    var band = '';
    var subject = raw.replace(/\bG\s?([1-3])\b/i, function (all, n) { band = 'G' + n; return ' '; });
    subject = subject.replace(/\s{2,}/g, ' ').replace(/^[\s\-\/]+|[\s\-\/]+$/g, '').trim();
    if (!subject) return null;
    return { subject: subject, band: band };
  }

  /* What a student is really taking in one column, band and all. */
  function allocationLabel(student, key) {
    var raw = norm(student.subjects && student.subjects[key]);
    if (!raw) return '';
    var p = sbbParts(raw);
    if (!p) return raw;
    var band = p.band || pgBand(student.pg);
    return p.subject + (band ? ' ' + band : '');
  }

  /* The distinct groups a column actually holds, counted, with the spelling
   * the school uses most often as the label. `implied` counts the students
   * whose band came from their posting group rather than the cell. */
  function allocationOptions(students, key) {
    var groups = {};
    (students || []).forEach(function (s) {
      var label = allocationLabel(s, key);
      if (!label) return;
      var id = normKey(label);
      var g = groups[id] || (groups[id] = { n: 0, implied: 0, spellings: {} });
      g.n++;
      var raw = norm(s.subjects[key]);
      var p = sbbParts(raw);
      if (p && !p.band) g.implied++;
      g.spellings[label] = (g.spellings[label] || 0) + 1;
    });
    return Object.keys(groups).map(function (id) {
      var g = groups[id];
      var label = Object.keys(g.spellings).sort(function (a, b) {
        return g.spellings[b] - g.spellings[a] || cmp(a, b);
      })[0];
      return { value: label, n: g.n, implied: g.implied };
    }).sort(function (a, b) { return cmp(a.value, b.value); });
  }

  /* Does a student's allocation in `key` answer to `want`? Exactly as written,
   * or as the same subject at the same effective band. */
  function allocationMatches(student, key, want) {
    var raw = norm(student.subjects && student.subjects[key]);
    if (!raw) return false;
    if (normKey(raw) === normKey(want)) return true;
    var a = sbbParts(raw);
    var b = sbbParts(want);
    if (!a || !b) return false;
    if (normKey(a.subject) !== normKey(b.subject)) return false;
    var band = a.band || pgBand(student.pg);
    return !b.band || b.band === band;
  }

  /* Columns that are plainly not subject allocations, however they were
   * ticked during the import review, plus values that are placeholders
   * rather than a class. Anything caught here is reported for the admin to
   * decide on instead of quietly becoming a teaching class. */
  var NON_SUBJECT_COLUMNS = ['year', 'level', 'class', 'classname', 'formclass', 'index',
    'indexno', 'sn', 'serialno', 'regno', 'register', 'admissionno', 'gender', 'sex',
    'dob', 'dateofbirth', 'age', 'nric', 'contact', 'remarks'];
  var PLACEHOLDER_VALUES = ['na', 'n', 'nil', 'none', 'no', 'x', 'tbc', 'tba', '0', '-'];

  function classProblem(subject, value) {
    if (NON_SUBJECT_COLUMNS.indexOf(normKey(subject)) !== -1) {
      return '"' + subject + '" is not a subject column';
    }
    if (PLACEHOLDER_VALUES.indexOf(normKey(value)) !== -1) {
      return '"' + value + '" is a placeholder, not a class';
    }
    if (/^\d+$/.test(norm(value))) {
      return '"' + value + '" is just a number — probably a year or a count';
    }
    return '';
  }

  /* A readable fallback code for an allocation the file gave no code for:
   * "Humanities (SS, Literature in English) - G3" -> "HUMANITIES-G3". */
  function fallbackCode(subject, band) {
    var base = norm(subject).replace(/\([^)]*\)/g, ' ').replace(/[^A-Za-z0-9 ]+/g, ' ');
    var words = base.split(/\s+/).filter(Boolean);
    var slug = words.length > 2
      ? words.map(function (w) { return w.slice(0, 3); }).join('').slice(0, 12)
      : words.join('').slice(0, 12);
    return (slug || 'CLASS').toUpperCase() + (band ? '-' + band.toUpperCase() : '');
  }

  /* Every distinct allocation across the students, as ready-made classes to
   * tag teachers onto. Codeless allocations fall back to a name+band slug.
   * Entries that do not look like allocations at all come back marked
   * `suspect` with a `why`, for the caller to surface rather than create. */
  function discoverClasses(students, level) {
    students = (students || []).filter(function (s) { return !hasLeft(s); });
    /* The subject columns in the order the students first show them. */
    var keys = [];
    var seenKey = {};
    students.forEach(function (s) {
      Object.keys(s.subjects || {}).forEach(function (k) {
        if (!seenKey[k]) { seenKey[k] = true; keys.push(k); }
      });
    });
    var list = [];
    keys.forEach(function (subject) {
      /* One class per teaching group, read through the school's labelling:
       * "SS/Hist" for a PG3 student and "SSHist G3" for another are the same
       * class, and the band a cell leaves out comes from the posting group. */
      allocationOptions(students, subject).forEach(function (opt) {
        var value = opt.value;
        var bits = value.split(' - ');
        var band = /^G\d$/i.test(bits[0]) ? bits[0] : '';
        var code = bits.length > 1 ? bits[bits.length - 1] : (band ? '' : bits[0]);
        var why = classProblem(subject, value);
        list.push({
          code: code || fallbackCode(subject, band),
          name: subject + (band ? ' - ' + band : ''),
          suspect: !!why,
          why: why,
          subject: subject,
          teachers: [],
          level: norm(level),
          autoMatch: subject + '=' + value,
          autoLevel: '',
          autoPg: '',
          autoClasses: '',
          n: opt.n,
        });
      });
    });
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
    var slotKeys = {};        // normalised subject -> the spelling first seen
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
        // "PHY" in one row and "Phy" in the next is one subject, not two —
        // and the value spells it the same way, so the two are one group.
        var key = slotKeys[normKey(a.subject)] || a.subject;
        slotKeys[normKey(a.subject)] = key;
        var value = normKey(a.value).indexOf(normKey(a.subject)) === 0
          ? (a.band ? key + ' ' + a.band : key)   // plain "DT G2"
          : a.value;                              // coded "G2 - K234"
        if (subjects[key] && subjects[key] !== value) {
          var n = 2;
          while (subjects[key + ' (' + n + ')']) n++;
          key = key + ' (' + n + ')';       // same subject twice: keep both
        }
        subjects[key] = value;
      });
      students.push({
        id: id, name: name, class: cls,
        level: cell(row, 'level'),
        gender: cell(row, 'gender'), pg: normPg(cell(row, 'pg')),
        tg: normTg(cell(row, 'tg')), sn: cell(row, 'sn'),
        origin: ORIGIN_FILE, sourceName: name, subjects: subjects,
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
    var changes = [];
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
      /* Both the displayed name and the one the school's file last used, so a
       * name corrected here still matches the file it came from. */
      var keys = [normKey(s.name)];
      var src = normKey(s.sourceName);
      if (src && src !== keys[0]) keys.push(src);
      keys.forEach(function (nk) {
        if (!(nk + '|' + s.class in byNameClass)) byNameClass[nk + '|' + s.class] = s;
        byName[nk] = nk in byName ? null : s;   // null marks an ambiguous name
      });
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
        /* A name edited here is the admin's correction and is kept; only the
         * file's own spelling is refreshed. */
        var wasFilesOwn = !norm(m.sourceName) || normKey(m.name) === normKey(m.sourceName);
        m.sourceName = imp.name;
        if (wasFilesOwn) m.name = imp.name;
        m.origin = ORIGIN_FILE;   // adopted: the school's file now lists them
        /* What the office actually changed about this student, so the admin
         * can see it rather than take "159 updated" on trust. */
        if (imp.class && normKey(imp.class) !== normKey(m.class)) {
          changes.push({ kind: 'moved', name: m.name, from: m.class, to: imp.class,
            text: m.name + ': class ' + m.class + ' → ' + imp.class });
        }
        if (imp.pg && normKey(imp.pg) !== normKey(m.pg)) {
          changes.push({ kind: 'pg', name: m.name, from: m.pg, to: imp.pg,
            text: m.name + ' (' + (imp.class || m.class) + '): PG ' + (m.pg || '—') + ' → ' + imp.pg });
        }
        if (imp.tg && normTg(imp.tg) !== normTg(m.tg)) {
          changes.push({ kind: 'tg', name: m.name, from: m.tg, to: imp.tg,
            text: m.name + ' (' + (imp.class || m.class) + '): TG/SG ' + (m.tg || '—') + ' → ' + imp.tg });
        }
        importedKeys.forEach(function (k) {
          var before = norm(m.subjects && m.subjects[k]);
          var after = norm(imp.subjects[k]);
          if (normKey(before) === normKey(after)) return;
          changes.push({ kind: 'subject', name: m.name, key: k, from: before, to: after,
            text: m.name + ' (' + (imp.class || m.class) + '): ' + k + ' ' +
              (before || '—') + ' → ' + (after || 'dropped') });
        });
        if (imp.class) m.class = imp.class;
        if (imp.level) m.level = imp.level;
        if (imp.gender) m.gender = imp.gender;
        if (imp.pg) m.pg = imp.pg;
        if (imp.tg) m.tg = imp.tg;
        if (imp.sn) m.sn = imp.sn;
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
          gender: imp.gender, pg: imp.pg, tg: imp.tg || '', sn: imp.sn || '', origin: ORIGIN_FILE,
          sourceName: imp.sourceName || imp.name, subjects: imp.subjects,
        });
        addedIds.push(newId);
        changes.push({ kind: 'added', name: imp.name, to: imp.class,
          text: imp.name + ' (' + (imp.class || '—') + '): new in this file' });
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
      changes: changes.concat(missing.map(function (s) {
        return { kind: 'missing', name: s.name, from: s.class,
          text: s.name + ' (' + s.class + '): no longer in the file' };
      })),
    };
  }

  /* Rename a teacher everywhere at once — the roster and every class they
   * are tagged to — so a corrected spelling never leaves orphaned classes. */
  function renameTeacher(model, from, to) {
    from = norm(from); to = norm(to);
    if (!from || !to) return 0;
    var touched = 0;
    model.groups.forEach(function (g) {
      var list = teacherNames(g);
      var next = [];
      var changed = false;
      list.forEach(function (t) {
        var v = normKey(t) === normKey(from) ? to : t;
        if (v !== t) changed = true;
        if (!next.some(function (e) { return normKey(e) === normKey(v); })) next.push(v);
      });
      if (changed) { g.teachers = next; touched++; }
    });
    model.teachers = (model.teachers || []).map(function (t) {
      return normKey(t) === normKey(from) ? to : t;
    }).filter(function (t, i, a) {
      return a.findIndex(function (e) { return normKey(e) === normKey(t); }) === i;
    }).sort(cmp);
    return touched;
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
    ['class', 'level', 'gender', 'pg', 'tg', 'sn', 'sourceName'].forEach(function (f) {
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
  /* A rule reads "HIST=HIST G3|HIST G2; TG=TG2": different columns are ANDed,
   * the values ticked inside one column are ORed. Older files hold a single
   * value per column, which parses to a one-entry list. */
  function matchers(group) {
    var out = [];
    var seen = {};
    function add(key, value) {
      key = norm(key);
      if (!key || seen[normKey(key)]) return;
      seen[normKey(key)] = true;
      var values = norm(value).split('|').map(norm).filter(Boolean);
      out.push({ key: key, values: values, value: values[0] || '' });
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
      .map(function (m) {
        var values = m.values || (m.value ? [m.value] : []);
        return norm(m.key) + '=' + values.map(norm).filter(Boolean).join('|');
      })
      .join('; ');
  }

  function groupHasRule(group) {
    return !!(matchers(group).length || norm(group.autoClasses) ||
      norm(group.autoPg) || norm(group.autoTg) || norm(group.level));
  }

  function matchesRule(student, group) {
    if (!groupHasRule(group)) return false;
    /* One Level on the class does both jobs: it labels the class on the
     * teacher page and keeps the class to that level's students. A student
     * whose Level cell the office left blank is NOT excluded — being unknown
     * must not mean being dropped from every namelist. */
    // Someone who has left is in no class, whatever their subject cells say.
    if (hasLeft(student)) return false;
    var level = norm(group.level);
    if (level && norm(student.level) && normKey(student.level) !== normKey(level)) return false;
    var tgs = splitList(group.autoTg);
    if (tgs.length) {
      var stg = normTg(student.tg);
      if (!tgs.some(function (t) { return normTg(t) === stg; })) return false;
    }
    var pgs = splitList(group.autoPg);
    if (pgs.length) {
      var spg = normKey(normPg(student.pg));
      if (!pgs.some(function (p) { return normKey(normPg(p)) === spg; })) return false;
    }
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
      if (!m.values.length) return true;      // any allocation in that column
      return m.values.some(function (want) { return allocationMatches(student, m.key, want); });
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

  /* Which subject column(s) a class is about: the columns its rule keys on,
   * or failing that its subject label if that matches a column. */
  function groupSubjectKeys(group, subjectKeys) {
    var keys = matchers(group).map(function (m) { return m.key; });
    if (keys.length) return keys;
    var label = norm(group.subject);
    if (!label) return [];
    return (subjectKeys || []).filter(function (k) { return normKey(k) === normKey(label); });
  }

  /* Allocations no class covers: a student takes HIST G3, but is in no class
   * built on the HIST column. Returned one row per subject+allocation, worst
   * first, each listing the students concerned.
   *
   * A subject with NO class at all anywhere is not reported per student — that
   * is "the classes have not been made yet", not a gap in an existing setup. */
  function coverageGaps(model) {
    var byStudent = {};      // studentId -> { subjectKey: true }
    var covered = {};        // subjectKey -> true (some class exists for it)
    var groupsByCode = {};
    (model.groups || []).forEach(function (g) {
      groupsByCode[g.code] = g;
      groupSubjectKeys(g, model.subjectKeys).forEach(function (k) { covered[normKey(k)] = true; });
    });
    (model.memberships || []).forEach(function (m) {
      var g = groupsByCode[m.groupCode];
      if (!g) return;
      byStudent[m.studentId] = byStudent[m.studentId] || {};
      groupSubjectKeys(g, model.subjectKeys).forEach(function (k) {
        byStudent[m.studentId][normKey(k)] = true;
      });
    });

    var gaps = {};
    (model.students || []).forEach(function (s) {
      if (hasLeft(s)) return;   // no class is missing for someone who has left
      Object.keys(s.subjects || {}).forEach(function (key) {
        var value = norm(s.subjects[key]);
        if (!value) return;
        if (!covered[normKey(key)]) return;             // no classes for this subject yet
        if (byStudent[s.id] && byStudent[s.id][normKey(key)]) return;
        var id = key + '|' + value;
        if (!gaps[id]) gaps[id] = { key: key, value: value, students: [] };
        gaps[id].students.push(s.id);
      });
    });
    return Object.keys(gaps).map(function (k) { return gaps[k]; })
      .sort(function (a, b) {
        return b.students.length - a.students.length || cmp(a.key, b.key) || cmp(a.value, b.value);
      });
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
      student.pg + ' ' + (student.tg || '') + ' ' + subjectSummary(student, keys)).toLowerCase();
  }

  /* ---- the printed namelist ------------------------------------------
   * The school's own layout: a banner naming the level, the posting/subject
   * group and the subject, with the head count on the right, then a bordered
   * grid of S/N, Class, Name, Gender and a Note column to write in. Both pages
   * render the same thing, so what a teacher sees is what prints. */

  /* "3" and "SECONDARY 3" both read as "Sec 3"; anything else is left as the
   * school wrote it. */
  function levelLabel(level) {
    var v = norm(level);
    if (/^\d+$/.test(v)) return 'Sec ' + v;
    var m = /^sec(?:ondary)?\s*([0-9]+[A-Za-z]?)$/i.exec(v);
    if (m) return 'Sec ' + m[1];
    m = /^pri(?:mary)?\s*([0-9]+[A-Za-z]?)$/i.exec(v);
    if (m) return 'Pri ' + m[1];
    return v;
  }

  function uniqueOf(list) {
    var seen = {};
    var out = [];
    list.forEach(function (v) {
      v = norm(v);
      if (!v || seen[normKey(v)]) return;
      seen[normKey(v)] = true;
      out.push(v);
    });
    return out;
  }

  /* What the banner across the top of a namelist says. Taken from the class's
   * rule where it has one, and read off its students where it does not. */
  function namelistMeta(group, members) {
    members = members || [];
    function fromMembers(read, cap) {
      var vals = uniqueOf(members.map(read));
      return vals.length && vals.length <= (cap || 3) ? vals : [];
    }
    var pgs = splitList(group.autoPg);
    if (!pgs.length) pgs = fromMembers(function (s) { return normPg(s.pg); });
    var tgs = splitList(group.autoTg);
    if (!tgs.length) tgs = fromMembers(function (s) { return normTg(s.tg); });
    /* What the class teaches, in the most telling words available: the ticked
     * group values ("SS/Geo", "POA G2") unless those are only a band and a
     * school code ("G3 - K341"), in which case the subject label says more. */
    var values = matchers(group).map(function (m) { return m.values.join(' / '); }).filter(Boolean);
    var bandOnly = values.length && values.every(function (v) {
      return /^G\d(\s*-\s*\S+)?$/i.test(norm(v));
    });
    var subject = (bandOnly || !values.length)
      ? (norm(group.subject) || values.join(' · ') || norm(group.name) || group.code)
      : values.join(' · ');
    if (bandOnly && values.length) subject += ' ' + values.join(' · ');
    /* The subject group usually leads with its posting group ("3 A" is PG 3,
     * group A), so printing both would read "PG 3 3 A". */
    var band;
    if (pgs.length && tgs.length &&
      tgs.every(function (t) { return normKey(t).indexOf(normKey(pgs[0])) === 0; })) {
      band = 'PG ' + tgs.join(', ');
    } else {
      band = [pgs.length ? 'PG ' + pgs.join(', ') : '', tgs.join(', ')].filter(Boolean).join('  ');
    }
    return {
      level: levelLabel(groupLevel(group, members)),
      band: band,
      subject: subject,
      total: members.length,
    };
  }

  /* One namelist as HTML — the same markup on screen and on paper. `esc` is
   * passed in because each page has its own. */
  function namelistHtml(group, members, esc, opts) {
    opts = opts || {};
    var meta = namelistMeta(group, members);
    /* An extra, never-printed column the caller fills — how the teacher page
     * puts a "not in my class" button beside each name without a second
     * namelist layout existing anywhere. */
    var extraHead = opts.actionHead ? '<th class="no-print">' + opts.actionHead + '</th>' : '';
    var cols = opts.actionHead ? 6 : 5;
    var rows = members.map(function (s, i) {
      return '<tr><td class="nl-sn">' + esc(norm(s.sn) || (i + 1)) + '</td>' +
        '<td class="nl-class">' + esc(s.class) + '</td>' +
        '<td class="nl-name">' + esc(s.name) + '</td>' +
        '<td class="nl-gender">' + esc(s.gender) + '</td>' +
        '<td class="nl-note"></td>' +
        (opts.rowAction ? '<td class="no-print nl-act">' + opts.rowAction(s) + '</td>' : '') +
        '</tr>';
    }).join('') || '<tr><td colspan="' + cols + '" class="nl-empty">No students in this class yet.</td></tr>';
    return '<table class="namelist-band"><tbody><tr>' +
      '<td>' + esc(meta.level) + '</td>' +
      '<td>' + esc(meta.band) + '</td>' +
      '<td class="nl-subject">' + esc(meta.subject) + '</td>' +
      '<td class="nl-pax">Total pax: <strong>' + meta.total + '</strong></td>' +
      '</tr></tbody></table>' +
      (opts.note ? '<p class="nl-sub">' + esc(opts.note) + '</p>' : '') +
      '<table class="namelist"><thead><tr><th>S/N</th><th>Class</th><th>Name</th>' +
      '<th>Gender</th><th>Note</th>' + extraHead + '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---- teacher suggestions ------------------------------------------
   * A teacher's page is read-only and usually has no write permission on the
   * shared folder, so a suggestion travels as text: a readable summary for the
   * human, and one base64 block for the app. Base64 rather than plain JSON
   * because mail clients hard-wrap long lines, and a break inside a quoted
   * name would make JSON unparseable — whereas base64 survives any wrapping
   * once the whitespace is stripped back out.
   */
  var REQ_MARK = 'NLREQ1';
  var REQ_END = 'NLEND';

  function b64encode(str) {
    var bin = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (_, h) {
      return String.fromCharCode(parseInt(h, 16));
    });
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bin, 'binary').toString('base64');
  }

  function b64decode(b64) {
    var bin = typeof atob === 'function' ? atob(b64)
      : Buffer.from(b64, 'base64').toString('binary');
    var pct = '';
    for (var i = 0; i < bin.length; i++) {
      var h = bin.charCodeAt(i).toString(16).toUpperCase();
      pct += '%' + (h.length < 2 ? '0' + h : h);
    }
    return decodeURIComponent(pct);
  }

  /* Same suggestion, same id — so a teacher who sends their whole list twice
   * does not give the admin the same card twice, and a suggestion already
   * decided does not come back from the dead. */
  function requestId(item) {
    var seed = [normKey(item.teacher), normKey(item.group), normKey(item.action),
      normKey(item.studentId) || normKey(item.name)].join('|');
    var h = 5381;
    for (var i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
    return 'r' + h.toString(36);
  }

  function requestLine(item, groupLabel) {
    var where = groupLabel || item.group;
    return (item.action === 'add' ? '  ADD     ' : '  REMOVE  ') + item.name +
      (item.action === 'add' ? '  to  ' : '  from  ') + where +
      (norm(item.reason) ? '  — ' + item.reason : '');
  }

  /* The whole message a teacher hands over: readable at the top so anyone can
   * see what is being asked, machine-readable at the bottom. */
  function requestsToText(items, teacher, madeIso, labelFor) {
    var made = madeIso || new Date().toISOString();
    var when = new Date(made);
    var body = { v: 1, teacher: teacher, made: made, items: items.map(function (it) {
      return { id: it.id || requestId(it), action: it.action, group: it.group,
        name: it.name, studentId: it.studentId || '', reason: it.reason || '' };
    }) };
    var adds = items.filter(function (i) { return i.action === 'add'; }).length;
    var payload = b64encode(JSON.stringify(body)).replace(/(.{76})/g, '$1\n');
    return 'NAMELIST REQUEST\n' +
      'From: ' + teacher + '\n' +
      'Sent: ' + (isNaN(when) ? made : when.toLocaleString()) + '\n' +
      items.length + ' suggestion' + (items.length === 1 ? '' : 's') +
      (items.length ? ' — ' + adds + ' to add, ' + (items.length - adds) + ' to remove' : '') + '\n\n' +
      items.map(function (it) {
        return requestLine(it, labelFor && labelFor(it.group));
      }).join('\n') + '\n\n' +
      'For the namelist administrator: open admin.html, go to Requests, and\n' +
      'paste this whole message into "Paste a request".\n\n' +
      REQ_MARK + '\n' + payload + '\n' + REQ_END + '\n';
  }

  /* Accepts the whole message, just the block, or bare JSON — whatever the
   * admin happened to select before pressing Ctrl+C. */
  function parseRequestText(text) {
    var raw = norm(text);
    if (!raw) return { error: 'Nothing to read — paste the message the teacher sent you.' };
    var body = null;
    var at = raw.indexOf(REQ_MARK);
    if (at !== -1) {
      var rest = raw.slice(at + REQ_MARK.length);
      var end = rest.indexOf(REQ_END);
      if (end !== -1) rest = rest.slice(0, end);
      try {
        body = JSON.parse(b64decode(rest.replace(/[^A-Za-z0-9+/=]/g, '')));
      } catch (e) {
        return { error: 'That request looks damaged — ask for it to be sent again, ' +
          'making sure the whole message is copied.' };
      }
    } else if (raw.charAt(0) === '{') {
      try { body = JSON.parse(raw); } catch (e) { body = null; }
    }
    if (!body || !Array.isArray(body.items)) {
      return { error: 'That is not a namelist request — it should contain a line saying ' +
        REQ_MARK + '.' };
    }
    var teacher = norm(body.teacher);
    var made = norm(body.made);
    var items = body.items.map(function (it) {
      var rec = {
        teacher: teacher, made: made,
        action: normKey(it.action) === 'add' ? 'add' : 'remove',
        group: norm(it.group), name: norm(it.name).toUpperCase(),
        studentId: norm(it.studentId), reason: norm(it.reason),
        status: 'open', decided: '', note: '',
      };
      rec.id = norm(it.id) || requestId(rec);
      return rec;
    }).filter(function (r) { return r.name && r.group; });
    return { teacher: teacher, made: made, items: items };
  }

  /* Fold incoming suggestions into the model. Anything already known — open or
   * decided — is left exactly as it is. */
  function mergeRequests(model, items) {
    model.requests = model.requests || [];
    var known = {};
    model.requests.forEach(function (r) { known[r.id] = r; });
    var added = 0, repeat = 0, decided = 0;
    items.forEach(function (it) {
      var have = known[it.id];
      if (!have) {
        model.requests.push(it);
        known[it.id] = it;
        added++;
      } else if (have.status && have.status !== 'open') decided++;
      else repeat++;
    });
    return { added: added, repeat: repeat, decided: decided };
  }

  function openRequests(model) {
    return (model.requests || []).filter(function (r) { return (r.status || 'open') === 'open'; });
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
    STATUS_LEFT: STATUS_LEFT,
    hasLeft: hasLeft,
    REQUEST_HEADERS: REQUEST_HEADERS,
    requestId: requestId,
    requestLine: requestLine,
    requestsToText: requestsToText,
    parseRequestText: parseRequestText,
    mergeRequests: mergeRequests,
    openRequests: openRequests,
    nextFreeId: nextFreeId,
    mergeStudents: mergeStudents,
    renameTeacher: renameTeacher,
    TEACHER_HEADERS: TEACHER_HEADERS,
    SUBJECT_HEADERS: SUBJECT_HEADERS,
    STUDENT_HEADERS: STUDENT_HEADERS,
    GROUP_HEADERS: GROUP_HEADERS,
    MEMBERSHIP_HEADERS: MEMBERSHIP_HEADERS,
    STUDENT_FIELDS: STUDENT_FIELDS,
    IMPORT_FIELDS: IMPORT_FIELDS,
    GROUP_FIELDS: GROUP_FIELDS,
    MEMBERSHIP_FIELDS: MEMBERSHIP_FIELDS,
    norm: norm,
    normKey: normKey,
    normPg: normPg,
    normTg: normTg,
    isTgHeader: isTgHeader,
    splitList: splitList,
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
    classProblem: classProblem,
    pgBand: pgBand,
    sbbParts: sbbParts,
    allocationLabel: allocationLabel,
    allocationOptions: allocationOptions,
    allocationMatches: allocationMatches,
    coverageGaps: coverageGaps,
    groupSubjectKeys: groupSubjectKeys,
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
    levelLabel: levelLabel,
    namelistMeta: namelistMeta,
    namelistHtml: namelistHtml,
    groupsByLevelFor: groupsByLevelFor,
  };
})();
