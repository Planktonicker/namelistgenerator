# Namelist Generator

An offline namelist tool for schools that lives entirely in one shared folder.
No server, no installation, no internet — just two HTML files next to an Excel file.

- **Teachers** open `namelist.html` (via a desktop shortcut), type their name, and see
  all their teaching-group namelists instantly — zero clicks to load data — and can
  print any one namelist or all of them as clean class registers.
- **Admins** open `admin.html` to import the raw student list, then build teaching
  groups fast: every subject/band column from the worksheet (EL, MT, MA, …) is its
  own sortable column — click a subject header to sort by allocation (students not
  taking it sort last), filter by class/PG or search any band (e.g. "MA G3"),
  click rows (Shift for ranges, or select-all-shown) and assign the whole selection
  to a group in one action. Saving updates the Excel master file, the teacher page's
  data, and a timestamped backup — all in one go.
- **`namelist.xlsx`** in the same folder is the master data store. It opens normally
  in Excel for viewing or printing, but should only be *edited* through `admin.html`.

Works in **Google Chrome** and **Microsoft Edge** (they provide the folder-access API
the admin page needs).

## The deployed folder

Copy the two files from `dist/` into your shared folder. After the first save it looks like:

```
Namelist/
  namelist.html      ← teacher view (this is what the shortcut points at)
  admin.html         ← admin editor
  namelist.xlsx      ← master data (regenerated on every save)
  data.js            ← auto-generated snapshot that makes the teacher page zero-click
  backups/           ← timestamped .xlsx backup written on every save
```

`data.js` exists because browsers forbid a double-clicked HTML page from silently
reading a neighbouring .xlsx. The admin page therefore writes this small snapshot
alongside the Excel on every save; the teacher page auto-loads it. As long as all
edits go through `admin.html`, the two can never drift apart.

## Setting up (admin, once)

1. Copy `dist/namelist.html` and `dist/admin.html` into the shared folder.
2. Open `admin.html` in Chrome/Edge → **Open data folder…** → pick that folder → **Allow**.
3. The folder is empty, so the app asks the only question that matters:
   **Choose the level files (Sec 1–5)…**. Pick the school's folder once, then it
   asks *"Which file is the Sec 1 namelist?"*, imports it, and moves on to Sec 2,
   and so on — Cancel stops the walkthrough at any point and the School files tab
   shows which levels still need a file. The alternatives below are tucked behind
   *Other ways to start*, for a one-off import or an empty list. That importer:
   - finds the real header row automatically, even below titles/dates;
   - auto-matches Name / Class / Gender / PG columns (correct them in the dialog if needed);
   - generates student IDs from class + row order (`1R1-01`, `1R1-02`, …) when the
     file has no unique ID column, keeping register order;
   - keeps the remaining columns (TG, EL, MT, HMT, MA, SCI, HIST, GEOG, LIT, …) as
     **subject/band columns** — sortable and searchable per student; untick any you
     don't want (PSLE/remark columns are unticked by default).
4. Create teaching groups. The fast way is **auto-allocation**: in Add group, type
   the teacher's name and pick the subject group she takes (e.g. `EL` → `EL G2`,
   optionally limited to classes like `1R`) — every matching student is allocated
   instantly, and new students from later school-file updates flow in automatically.
   The group code/name are suggested for you. Members can still be adjusted by hand
   afterwards (Students tab bulk-select, or the Group members tab) — auto-allocation
   only ever *adds*, so manual changes stick; re-check a group any time with its
   **Auto-fill from rule** button. Then press **Save**.
5. Make a desktop shortcut for teachers (see below).

### Keeping levels up to date from the school's files

The school's own allocation files (e.g. `Sec 1 Subject Allocation_14 Jan.xlsx`,
dated `Sec 4_Final Classlist` versions) can live anywhere — a private admin share
like `S:\_Admin\...` is fine, and they are never modified or exposed to teachers.
In the **School files** tab:

1. **Choose school files folder…** → pick the folder (once per device; afterwards the
   button reconnects it with a single permission click).
2. **Add Sec 1–5** creates the five levels in one go (or **Add level** for anything
   else). For each, click **Choose file…** and pick which file in the folder is that
   level's namelist — **the files can be named anything**. The choice is stored in
   `namelist.xlsx`, so every admin on every device sees the same assignment; only the
   folder connection is per-device, which means drive letters and UNC paths don't
   matter.
3. Picking a file imports it straight away. The right sheet, header row and columns are
   detected automatically; you see a summary (how many students, which classes) before
   anything changes. Students are matched **by name**, so their IDs and group
   memberships are kept; only that level's classes are touched, only the subject
   columns present in the file are refreshed, and you decide whether students who
   dropped off the list are removed. Then press **Save** as usual.
4. Afterwards the Status column keeps each level honest:
   - *up to date* — nothing to do
   - *updated <date>* — the same file changed since the last import; **Update all**
     refreshes every such level at once
   - *newer file under another name* — the office saved a new version under a new
     name; the app suggests it but never switches silently, so one click confirms
   - *file not found* — the chosen file is gone; pick again

Running the same file twice is harmless — everyone matches, nothing changes.

**Reconnecting.** Chrome/Edge remember both folders between sessions, so after
the first time the start screen offers **Reconnect to “…”** — a single
permission click instead of navigating the shared drive again. The School files
button does the same for the sources folder. "Choose a different folder…" is
always available if anything moves.

**Adding a student the school's file doesn't have yet.** Use **Add student** in
the Students tab (a late transfer, a new enrolment). Fill in the details —
class, gender, PG and each subject band; the student ID is suggested
automatically as the next free slot in that class register (`1R1-27`). Such
students are:

- stored **only in the app's own `namelist.xlsx`** — the school's official file
  is never written to;
- marked with an **added** badge, and findable via the "Added here only" filter;
- **kept when a level is refreshed** — the school's file has no opinion about
  them, so they are never proposed for removal;
- **adopted automatically** if the office later lists them: the name match
  updates them in place, keeps their ID and group memberships, and flips them
  to file-sourced — no duplicate is created.

**The official files can never be modified by this app.** Three independent
safeguards make this true:

1. The "Choose school files folder" picker requests **read-only** permission
   (`mode: 'read'`) — Chrome/Edge itself refuses any write into that folder,
   no matter what the page's code does.
2. Files picked by hand come through a plain file input, which browsers expose
   read-only — there is no write path at all.
3. The app only ever writes three names — `namelist.xlsx`, `data.js`,
   `backups/…` — and only inside its own data folder chosen on the start
   screen. If that folder pick ever lands on a folder full of other
   spreadsheets, the app warns before proceeding.

On top of that, since the official files live on a share you don't own, normal
Windows permissions (read-only access for the admin account) remain the outer
wall — the app works fine with read-only access to that folder.

### Daily use

- **Teachers:** double-click the shortcut → type your name → your namelists appear.
  **Print** any single group or all of them; printouts include a Remarks column for
  marking. "Find a student" looks up any student by name, class, ID or tag.
- **Admins:** open `admin.html` → pick the folder (Chrome asks once per session) →
  edit → **Save**. The moment you save, every teacher who reopens the page sees the
  update. Any group's namelist can also be printed from the Group members tab.

## Windows shared-drive notes

- Both UNC paths (`\\server\share\Namelist\...`) and mapped drives (`Z:\Namelist\...`) work.
- **Recommended:** give teachers **read-only** permission on the folder and admins
  **read/write**. Windows then enforces who can actually change the data — a page in a
  browser can't offer real password protection.
- Teacher shortcut that always opens in Chrome/Edge — right-click desktop → New →
  Shortcut, and use one of:
  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" "\\server\share\Namelist\namelist.html"
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "\\server\share\Namelist\namelist.html"
  ```
- If two admins edit at the same time, the second save warns that the file changed and
  the earlier version is kept in `backups/` — nothing is silently lost. Clear out old
  backups occasionally if the folder gets large.

### One-minute pilot test (before rolling out)

On a normal school machine: open `admin.html`, pick the folder, add a test student,
Save. Then open `namelist.html` — the change should be there. If the **Open data
folder** button does nothing, your IT group policy may block the File System Access
API; ask IT to allow it for Chrome/Edge.

## Development

```
src/teacher.html         authored pages (open directly in a browser while developing)
src/admin.html
src/shared/schema.js     data layer: xlsx ↔ model ↔ data.js, validation, indexes
src/shared/styles.css    shared look for both pages
vendor/xlsx.full.min.js  SheetJS 0.18.5 (committed for offline builds)
build.mjs                inlines vendor/shared assets → self-contained dist/ pages
tools/gen-sample.cjs     deterministic sample data → sample/
test/roundtrip.test.cjs  schema round-trip + validation tests
test/conflict.browser.mjs  save/conflict/backup path against a fake filesystem
test/allocation-format.browser.mjs  ministry-format import -> discover -> teach
test/setup-flow.browser.mjs  first run asks which file is each level
```

Requires only Node (no npm packages):

```
node test/roundtrip.test.cjs   # data-layer tests
node tools/gen-sample.cjs      # regenerate sample/namelist.xlsx + sample/data.js
node build.mjs                 # rebuild dist/
```

The save path (folder handles, conflict detection, backups) additionally has a
browser test that needs Playwright installed:

```
PLAYWRIGHT_CHROMIUM=/path/to/chromium node test/conflict.browser.mjs
PLAYWRIGHT_CHROMIUM=... ALLOCATION_XLSX=/path/to/allocation.xlsx \
  node test/allocation-format.browser.mjs
PLAYWRIGHT_CHROMIUM=... ALLOCATION_XLSX=/path/to/allocation.xlsx \
  node test/setup-flow.browser.mjs
```

### Source file layouts

Two shapes of school file are recognised automatically.

**Fixed subject columns** — one column per subject, the band in the cell:

| Name | Class | PG | EL | MT | MA |
|---|---|---|---|---|---|
| … | 1R1 | 3 | EL G3 | CL G3 | MA G3 |

**Positional subject slots** (the ministry allocation format) — generic
`Subject 1 … Subject 20` columns, with the subject named inside the cell as
`Subject - Band - Code`:

| Class Name | Reg# | Student Name | Subject 1 | Subject 2 |
|---|---|---|---|---|
| 3S1 | 1 | … | English Language - G2 - K200 | Mathematics - G2 - K210 |

For the second shape the app splits each cell into subject, band and class
code, so the students table still shows one readable column per subject
(*English Language*, *Mathematics*, …) rather than *Subject 1…20*. The code
(`K200`) identifies the teaching class, so **Find classes in the data** in the
Teaching groups tab creates every class the file already implies, allocates
its students, and leaves you only to tag teachers. Register numbers, where
present, give stable ids (`3S1-01`).

Cells without a band or a code are ignored, which quietly filters out the
notes admins leave in spare slot columns.

### Teachers and classes

A class can be taught by **several teachers** — add them as chips in the class
dialog; each of them sees the class under their own name. A class also has:

- a **Level label**, which is only how the teacher page groups the class
  ("Sec 3"); and
- rule fields — **Only this level**, **PG**, **classes**, and any number of
  **must be taking** criteria — which decide who is allocated to it.

Keeping those separate matters: a class discovered from a file gets a level
label but no level *filter*, so a student whose Level cell the office left
blank still lands in their classes instead of vanishing from every namelist.
The warnings panel lists any student who ends up in no class at all.

Several criteria can apply at once, which is what reproduces a query like
"Level 3, PG3, SG = 3 A, Subject = SS/Geo" from a setup grid.

### Two people editing at once

`namelist.xlsx` is the app's own file and is meant to be written **only** by
`admin.html`. If it changes on disk between an admin loading it and pressing
Save, the app says so and offers to overwrite or to cancel; either way the
version currently on disk is copied into `backups/` first, so nothing is lost.
Whoever saves last wins the live file — there is no merge.

Editing `namelist.xlsx` by hand in Excel is therefore discouraged: besides the
conflict risk, the app regenerates `data.js` only when *it* saves, so a manual
Excel edit leaves the teacher page showing the older data until an admin opens
`admin.html` and presses Save. View or print the workbook freely; make changes
through the app.

To try the teacher page locally: copy `sample/data.js` next to `dist/namelist.html`
and open it in a browser. The admin page can be exercised against a local folder
containing `sample/namelist.xlsx`.

### Data format

`namelist.xlsx` has three sheets, matched by header name (extra columns are ignored):

| Sheet | Columns |
|---|---|
| Students | StudentID, Name, Class, Level, Gender, PG, Origin, then one column per subject |
| Groups | GroupCode, GroupName, Subject, Teachers, Level, AutoMatch, AutoLevel, AutoPG, AutoClasses |
| Memberships | StudentID, GroupCode |
| Sources | Level, SourceFile, FilePattern, LastFile, LastImported |

On the Students sheet, any header that isn't one of the fixed five is treated as a
subject/band column holding that student's allocation (e.g. `EL G3`, `CL G2`) —
the same shape as the school's raw worksheet, so the saved file stays familiar.

A teacher's namelists = the members of every group whose Teacher field is their name.
