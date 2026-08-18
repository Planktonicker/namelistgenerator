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

**Preparing next year's files?** [`docs/conventions.md`](docs/conventions.md)
is the one-page version for the office and the admin: what the app looks for in
a school file, how subject bands and names should be written, and how to roll
over to a new year.

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
4. Create teaching groups. The fast way is **auto-allocation**: in Add class, pick
   the teacher, then tick the subject group she takes (e.g. column `EL` → `EL G2`),
   optionally a PG and some form classes — the dialog says how many students the
   ticks cover, every one of them is allocated on OK, and new students from later
   school-file updates flow in automatically. The class code/name are suggested for
   you. Members can be adjusted right there (untick anyone in the **Members** list)
   or later from the Group members tab — auto-allocation only ever *adds*, so manual
   changes stick; re-check a class any time with its **Auto-fill from rule** button.
   Then press **Save**.
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

### Keeping itself up to date

Opening `admin.html` refreshes the levels from the school's files by itself —
no prompt, no confirmations. It rescans the school folder, re-imports every
level whose file is newer than the last import, saves, and republishes
`data.js`, then says what it did in a bar at the top ("Updated from the school
files — Sec 3: 12 updated, 2 added").

Two things it deliberately will *not* do on its own:

- **Delete anybody.** Students who dropped off a file are listed in the
  warnings panel for you to act on, never removed automatically.
- **Import a level whose columns changed.** If a column appeared or vanished,
  that level is skipped and flagged, because it is a decision rather than a
  refresh.

Chrome only lets a page read a folder while permission stands, so if the
permission has lapsed the bar offers a single **Check for updates now** button
instead — that click is the only manual step, and everything after it is
automatic. The teacher page, for its part, says how old its data is if the last
publish was more than a fortnight ago.

**Reconnecting — one gesture per browser session.** Chrome/Edge remember both
folders between sessions, so after the first time the start screen offers
**Reconnect to “…”** rather than making you navigate the shared drive again.
The *handle* is remembered; the *permission* cannot be, because a page opened
from a drive (`file://`) is not a site the browser can attach a standing grant
to. Chrome's “Allow on every visit” is offered only to `http(s)` pages. So one
gesture per browser session is a browser rule, not a setting this app can
change.

It is made as small as possible: the Reconnect button is focused when the page
opens, and **Enter, the space bar, or a click anywhere on the start screen**
reconnects. Opening the app is therefore: shortcut → Enter. Reopening a tab in
the same browser session does not ask again.

The only way to remove the prompt entirely is to stop using `file://` — serve
the folder over `http(s)` from the school's own server or IIS, at which point
Chrome treats it as a site and offers to remember the permission for good.

**Autosave.** On by default. Every change schedules a save four seconds later
(and no more than thirty seconds after the first unsaved change), so leaving the
page or losing the machine does not lose work. The topbar says which state you
are in — *Unsaved — saving shortly*, then *Saved 09:51 AM* — and closing the tab
flushes anything still pending.

Three things keep it safe on a shared drive:

- **It never overwrites another admin.** If `namelist.xlsx` changed on disk since
  you loaded it, autosave stops and says so in red: *Not saved — someone else
  saved namelist.xlsx. Reload, or press Save to overwrite.* Nothing is written
  until you choose.
- **It does not flood `backups/`.** An automatic save takes a backup at most once
  an hour. Pressing **Save** yourself always takes one.
- **It can be turned off** with the *Autosave* box in the topbar, per copy of the
  app. With it off, the browser warns before you close with unsaved changes, as
  before.

**A folder with the pages but no data.** Opening a folder that has no
`namelist.xlsx` is the setup screen, which says plainly that saving will create
`namelist.xlsx` and `data.js` right there, and offers two ways to carry on
rather than starting again:

- **Use an existing namelist.xlsx…** — point at the old folder's workbook. It is
  read, never written, and the first **Save** writes a fresh copy into *this*
  folder, data.js and all.
- **Rebuild from the data.js here** — offered when the folder still has a
  `data.js` from a previous save but the workbook has been lost. Students,
  classes and memberships come back; the School files settings do not, so the
  levels have to be pointed at their files again, and the app says so.

**Each copy of the app remembers its own folder.** Browsers keep folder handles
for the whole `file://` origin, so a second copy of `admin.html` — a new year's
folder, a test copy, a colleague's drive — used to open, reconnect to the
*original* folder and save there, leaving the new folder's `namelist.xlsx`
untouched and apparently broken. What a page remembers is now keyed to the
folder that page was opened from: a copy starts with a clean slate and asks
which folder it should use, and the original keeps its own. If the folder a page
remembers is not the folder the page itself sits in, the start screen says so —
that is legitimate (the data folder may live elsewhere), but it is also exactly
what a half-finished copy looks like. The School files
button does the same for the sources folder.

**Changing folder later.** Neither choice is permanent. **Choose a different
folder…** sits next to the connected folder's name in the School files tab, and
again inside the "which file is this level" picker — so a folder picked in
error, or a share the school reorganises, is swapped without restarting: the
picker relists the new folder on the spot and each level keeps the file name it
was pointed at.

**Adding a student the school's file doesn't have yet.** Use **Add student** in
the Students tab (a late transfer, a new enrolment). **The level is answered
first and decides the rest**: class, gender, PG, TG/SG and the subject list are
all dropdowns drawn from that level's students, and each subject offers only the
groups that level runs — so a Sec 4 student is never offered 1R1, and Sec 1 is
never offered POA. A class that does not exist yet can still be typed in through
**Other…**.

There is **no student ID to fill in**: it is allocated as the next free slot in
that class's register (`1R1-27`) and the dialog says which one it will use. The
**full name** is asked for in capitals — the app upper-cases it as you type —
because that name is what every later school-file update matches on. Such
students are:

- stored **only in the app's own `namelist.xlsx`** — the school's official file
  is never written to;
- marked with an **added** badge, and findable via the "Added here only" filter;
- **kept when a level is refreshed** — the school's file has no opinion about
  them, so they are never proposed for removal;
- **adopted automatically** if the office later lists them: the name match
  updates them in place, keeps their ID and group memberships, and flips them
  to file-sourced — no duplicate is created.

**Editing a student's name.** Names can be corrected at any time from
**Edit** in the Students tab — including for students that came from the
school's file. The app remembers the spelling the file uses separately from the
one you type, so your correction is kept on every later import instead of being
overwritten, and the student still matches their row in the file. Such a
student carries an **edited** badge; hovering it shows what the office calls
them. If the office later adopts the same spelling, the two simply converge.

The one case the app will not decide for you is the office renaming somebody
whose name you never touched — "Nur Aisyah" becoming "Nur Aisyah Bte Rahman"
could be a rewrite or a different student. That produces two records, a
**possible duplicate** warning naming both, and **Merge** to settle it.

That adoption is deliberately forgiving, because a student entered by hand and
the same student typed by the office rarely match character for character. As
well as an exact name match, a student added in the app is recognised when the
file has moved them to another class, writes the name in a different order
("Tan Wei Ming" / "Wei Ming Tan"), or adds something to it ("Tan Wei Ming
(Nathan)") — while two genuinely different names are never merged. Anything
that still slips through is reported as a **possible duplicate** in the
warnings panel; select the two records in the Students tab and press **Merge**
to fold them into one, keeping the school file's record and moving the classes
across.

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

- **Teachers:** double-click the shortcut → **type a few letters of your name** → your
  classes appear as chips; click one to see just that namelist, or leave it on *All*
  to see them all. **Print** any single class or all of them; printouts carry a
  Remarks column for marking. The second tab, **All classes**, lists every class in
  the school with filters for level, subject and teacher — useful when covering a
  colleague — and its search box also accepts a student's name, which brings back
  the classes that student is in. **Suggest a change** on any namelist collects
  additions and removals to send to the admin, who decides.
- **Admins:** open `admin.html` → pick the folder (Chrome asks once per session) →
  edit → **Save**. The moment you save, every teacher who reopens the page sees the
  update. Any group's namelist can also be printed from the Group members tab.
  **Click a student's name** (or double-click their row) to open them and change
  anything about them — see *Opening a student* below.

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
- Two admins can edit at the same time: each one's work is merged into the other's page
  within a few seconds, and only a field both of them changed needs a decision. See
  *Two people editing at once*. Clear out old backups occasionally if the folder gets large.

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
test/auto-update.browser.mjs  opening the editor refreshes levels by itself
test/class-dialog.browser.mjs  teacher roster + building a class from criteria
test/edit-class.browser.mjs    editing a class re-applies its rule; members untick
test/coverage-changes.browser.mjs  coverage gaps, the change report, pasted staff
test/carry-over.browser.mjs    an empty folder: carry data over, or rebuild from data.js
test/teacher-page.browser.mjs  teacher dropdown, class chips, the All classes tab
test/add-student.browser.mjs   level-first add-student dialog
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
PLAYWRIGHT_CHROMIUM=... node test/class-dialog.browser.mjs
PLAYWRIGHT_CHROMIUM=... node test/edit-class.browser.mjs
PLAYWRIGHT_CHROMIUM=... node test/coverage-changes.browser.mjs
PLAYWRIGHT_CHROMIUM=... node test/carry-over.browser.mjs
PLAYWRIGHT_CHROMIUM=... node test/teacher-page.browser.mjs
PLAYWRIGHT_CHROMIUM=... node test/add-student.browser.mjs
PLAYWRIGHT_CHROMIUM=... ALLOCATION_XLSX=/path/to/allocation.xlsx \
  node test/allocation-format.browser.mjs
PLAYWRIGHT_CHROMIUM=... ALLOCATION_XLSX=/path/to/allocation.xlsx \
  node test/setup-flow.browser.mjs
PLAYWRIGHT_CHROMIUM=... ALLOCATION_XLSX=/path/to/allocation.xlsx \
  node test/auto-update.browser.mjs
```

### Coping with files that keep changing shape

Every level's file is laid out differently, and each one drifts year to year —
a column renamed, moved, or added; an extra title row; a different name for the
tutorial/subject group. Three things absorb that without constant fiddling.

**Columns are matched by name, never by position.** A column that moves is a
non-event. Names are matched loosely too, so `Class`, `Class Name` and
`Class 2026` all read as the class, and title rows above the real header are
skipped automatically.

**Each level remembers its own mapping.** The first time you import a level the
app shows what it worked out — sheet, header row, which column is the name, the
class, the PG, and which of the remaining columns are subject allocations — and
you correct anything it got wrong. That mapping is saved in `namelist.xlsx`
against the level, so it is shared with every admin and reused on every later
import. Re-importing a level normally asks nothing at all.

**You are only interrupted when something genuinely changed.** If the file
gains a column, loses one the mapping relied on, or you press **Columns…** on a
level, the review reopens with the change flagged — new columns are marked
*new*, and columns the mapping expected but can't find are called out. Anything
else imports silently.

Two smaller knobs in that dialog handle the rest:

- **Untick** a column to ignore it (free-text remarks, a `Pending` note column).
- **Store as** renames a column, which is how a level whose file says `SCII`
  merges into the `SCI` used everywhere else instead of becoming a second column.

### Tutorial groups / subject groups (TG, SG)

Some levels split a subject into teaching groups that are **not** the form
class: SG1–SG6 across 1R1–1R6, or TG1/TG2 within a level. The app treats TG and
SG as the same thing — one field on the student, shown as **TG/SG**:

- a `TG`, `SG`, `Sub Group`, `Tutorial Group` or `Subject Group` column in the
  school's file is picked up automatically — and if a file names it something
  else entirely, point the **TG / SG** row of the column review at it;
- it appears as a column and a filter in Students and Group members, is
  searchable, and is its own tick row when you build a class;
- it prints on the teacher's namelist whenever the class has one;
- levels whose files have no such column are unaffected — the control stays
  hidden.

An existing `namelist.xlsx` where TG came in as an ordinary subject column is
converted on load: the value moves onto the student, the column disappears from
the subject list, and any class rule that pointed at it is rewritten to the new
field. Nothing needs to be redone by hand.

### Subject-based banding, however it was typed

The band a student takes a subject at is often left out of the cell, because
the posting group already says it — and the subject itself is written however
the teacher writes it. The app reads an allocation as a **subject plus an
effective band**: the band in the cell if there is one, the posting group's band
if there is not.

| PG | Cell says | Read as |
|---|---|---|
| 3 | `SS/Hist` | History at G3 |
| 3 | `SSHist G3` | History at G3 — same class |
| 2 | `SS/Hist G3` | History at G3 — taken above their posting group |
| 2 | `SS/Hist` | History at G2 |

So `SS/Hist`, `SSHist` and `SS Hist` are one subject (spacing, slashes and case
are noise), and one node in the class builder covers every student who belongs
in that teaching group whichever way their row was filled in. Nodes whose
membership includes students with no band in the cell are marked `*`.

Real numbers from a Sec 3 grouping list, where the same class is written four
different ways:

```
in the file                            read as
SS/Hist      PG3   ×28   ┐
SSHist G3    PG3   × …   ├──────────►  SS/Hist G3   ×33   (28 from PG)
SS/Hist G3   PG2   × 5   ┘
SS/Hist      PG2   ×17   ──────────►   SS/Hist G2   ×18   (17 from PG)
```

Ministry-coded cells (`G3 - K300`) name their class outright, so they are left
exactly as they are — there is nothing to infer, and a K-code still matches
itself and nothing else.

### Positional subject columns (Sub 5, Sub 6, Sub 7)

Upper-secondary files list the electives in numbered slots rather than named
columns: POA can sit under `Sub 5` for one student and `Sub 7` for the next.
The app reads the subject out of the cell rather than the heading, so all of
them land under one **POA** column whichever slot they came from. Two details
make that reliable:

- the stored value names its own subject (`POA G2`, `DT G2`), so a bare `G2`
  from one slot can never be confused with another subject's `G2`;
- a subject spelled two ways in one file (`PHY` and `Phy`) is folded into the
  spelling seen first, so it is one column and one class, not two.

A student who genuinely takes the same subject twice (a rare double entry) keeps
both, the second under `SUBJECT (2)`.

### Source file layouts

Two shapes of school file are recognised automatically.

**Fixed subject columns** — one column per subject, the band in the cell:

| Name | Class | PG | EL | MT | MA |
|---|---|---|---|---|---|
| … | 1R1 | 3 | EL G3 | CL G3 | MA G3 |

**Positional subject slots** — generic `Subject 1 … Subject 20` or `Sub 5 … Sub 7`
columns, where the subject is named inside the cell. Two dialects are read, and
which one a file speaks is worked out by sampling it: `Subject - Band - Code`
(ministry allocation files) and plain `Sci CB G3` / `DT` (the school's own
grouping lists). This matters because the same subject sits in `Sub 6` for one
student and `Sub 7` for another, so reading such columns by position would split
one class in two:

| Class Name | Reg# | Student Name | Subject 1 | Subject 2 |
|---|---|---|---|---|
| 3S1 | 1 | … | English Language - G2 - K200 | Mathematics - G2 - K210 |

A file can mix both: the Sec 3/4 lists have fixed `EL`, `MTL`, `MA`, `HUM`
columns *and* positional `Sub 5`–`Sub 7` slots, and both are read.

For the positional shape the app splits each cell into subject, band and class
code, so the students table still shows one readable column per subject
(*English Language*, *Mathematics*, …) rather than *Subject 1…20*. The code
(`K200`) identifies the teaching class, so **Find classes in the data** in the
Teaching groups tab creates every class the file already implies, allocates
its students, and leaves you only to tag teachers. Register numbers, where
present, give stable ids (`3S1-01`).

Cells without a band or a code are ignored, which quietly filters out the
notes admins leave in spare slot columns.

### Teachers and classes

Teacher names live in the **Teachers** tab, so they are picked from a list when
you build a class rather than retyped — no more two spellings of one person.
Press **+** to add a name straight into the list — or **Paste list…** at the
start of the year, which takes a whole staff list pasted from a spreadsheet or
an email (one name per line, numbering and stray commas tolerated) and adds only
the names that are new. Click any name to change it
(the app asks you to confirm before saving, since **renaming one updates every
class it is tagged to**). **Classes…** on a teacher's row hands them their
classes after the fact. In the class dialog the teacher box starts blank — it
never shows a name nobody has chosen — and a name picked there is added by
**Add** or, if you go straight past it, by **OK**. The classes are **grouped under their level** — Sec 1's
under a Sec 1 heading, Sec 4's under Sec 4 — each a tick box with its size, and
the level is not repeated on every chip. Narrow further by subject or level with
the two dropdowns; the list scrolls in its own box, and the line underneath says
what they will be teaching before you press OK.
A class can be taught by several teachers; each of them sees it under their own
name, with the others noted as co-teachers.

The rest of a class is built as a **drill-down**: answer the level, and the
subjects that level runs appear; pick a subject, and its groups appear; and so
on down the branches, each one drawn only from what the answers above leave
possible, with a count on every option and a running total underneath. Nothing
you don't need is on screen:

It is a **mind map**, not a form. Every option is a node with its student count
on it; clicking one hangs the next branch directly under that very node, joined
by a curve. The path you have taken is navy, the branches not taken are faint,
and the map scrolls to follow the branch you just opened.

```
LEVEL    [Every level]  [Sec 1 159]  [Sec 4 203]
                                          │
SUBJECT  [Any subject] [EL 203] [MA 203] [MTL 203] [Hum/CPA 203] [DT 57]
         [Sci PC 61]   [POA 83] [Sci CB 83] [Art 19] [AM 39] [NFS 50] …
                          │
GROUP            [POA 57]  [POA G2 26]
                                 │
TG / SG   [SG1 37] [SG2 28] [SG3 28] [SG4 34] [SG5 38] [SG6 38]
                                        │
MORE                            More filters…
```

Each branch is drawn only from what the answers to its left leave possible: pick
Sec 4 and the subjects are Sec 4's, the groups are that subject's at that level,
and the tutorial groups are the ones those students are actually in.


| Field | What it does |
|---|---|
| **Level** | groups the class under that heading on the teacher page, *and* keeps it to that level's students |
| **Must be taking** | pick a column, tick its groups — several ticks in one column mean "either" (`HIST G3` or `HIST G2`), and a second column narrows further (`TG = TG2`). A column with nothing ticked means *anyone taking that subject*, and the count line says so |
| **PG** | tick one or more posting groups (always 1, 2, 3 — a file that writes `PG2` is read as `2`). Behind **More filters…** at every level, because the subject group already says which posting group a student is in |
| **TG / SG** | tick tutorial / subject groups — the teaching group a student sits in, which need not follow the form class (SG3 can span 1R1–1R6). Hidden for levels whose files have no such column |
| **Form class** | tick the form classes |
| **Members** | everyone currently on the namelist, each with a tick — untick anyone who should not be there, or **Tick all** / **Untick all** in one go |

**Subject** is a list, like teachers: **New…** adds one (*History*), every later
class picks it from the dropdown, and **Remove** takes a wrong one off the list
without touching the classes already labelled with it. The list is stored in
`namelist.xlsx` alongside the teachers.

The class has **one name**, and that name is also its code — there is no second
field to keep in step. A code only appears when it says something the name does
not: classes discovered from a ministry-format file keep the school's own code
(`K300`) and show it beside the name in the list and under **Advanced — class
code…** in the dialog, where it can also be set by hand if your school files
expect a particular code. Renaming a class carries its code (and its students)
along, unless you gave it a code of its own.

**Clear the map** starts the rule over without closing the dialog — the only way
back out of a single-choice branch, and quicker than unticking a path node by
node.

**Answering higher up the map clears what hung below it.** A class built for
Sec 4 POA cannot keep Sec 1's tutorial groups, so picking a different level
clears the subject, group, TG/SG and the rest; picking a different subject
clears its group and below; and so on down. What you see is always reachable
from the answers above it.

**PG is behind More filters… at every level** — the subject group already says
which posting group a student is in, so it is a trap far more often than a
filter. From **Sec 3** the form class joins it there, since upper secondary is
grouped by subject group rather than by form class. Both are one click away when
genuinely meant, and open already for a class that uses them.

Ticking nothing means "any", and a student whose Level cell the office left
blank is never excluded by the level — being unknown must not mean disappearing
from every namelist. The warnings panel lists anyone who ends up in no class at
all.

Because the criteria stack, a class is usually created already full of the
right students. **Editing a class re-applies its rule**, so fixing the criteria
of a class that came out empty fills it immediately; if the change narrows the
rule, the app offers to drop the members who no longer match. The **Members**
list is the place to handle the exceptions — half of 1R5 shared with another
teacher is 27 matched, four unticked, 23 on the namelist — and unticked
students stay out even when the rule is applied again. That also reproduces a
namelist query like "Level 3, PG3, SG = 3 A, Subject = SS/Geo" from a setup
grid.

**Classes found in the data.** *Find classes in the data* creates one class per
allocation the school's file already contains. Columns that are plainly not
allocations — a `Year` column holding `2026`, a placeholder `N/A` — are **not**
turned into classes; they appear under **Check these** with *Create it anyway*
and *Ignore*, so a mislabelled column is a decision rather than a phantom class
in the list.

### The printed namelist

Every namelist — on screen, in the teacher page's **Print**, and in the admin's
**Print this namelist** — uses the school's own layout, so what a teacher looks
at is what comes out of the printer:

```
┌──────────┬───────────┬──────────────────────┬───────────────────┐
│ Sec 3    │ PG 3 A    │ SS/Geo               │    Total pax: 15  │
└──────────┴───────────┴──────────────────────┴───────────────────┘
┌──────┬───────┬──────────────────────────┬────────┬─────────────┐
│ S/N  │ Class │ Name                     │ Gender │ Note        │
├──────┼───────┼──────────────────────────┼────────┼─────────────┤
│  25  │ 3S1   │ TAN JAE REN              │ M      │             │
│  45  │ 3S2   │ EDGAR KAUNG ZARNI HEIN   │ M      │             │
```

The **Name column is as wide as the longest name in that class** and no wider —
a margin after it, and the Note column takes whatever is left, so there is room
to write beside short names and nothing is truncated beside long ones.

The banner names the level, the posting/subject group and the subject, with the
head count on the right — read from the class's own rule, or off its students
when it has none. **S/N is the school's own serial number**, captured from the
`S/N` (or `No`) column when a level is imported, so a printed list can be
checked against the office's list line by line; a student added in the app, who
has no S/N of their own, falls back to their row number. **Note** is left blank
to write in.

### Finding your name

The staff list is a type-to-search box rather than a long dropdown: a hundred
names is no fun to scroll past to reach your own.

Type any part of your name — first name, surname, or a fragment of either — and
the list narrows as you go, with the matched letters marked so a long list can
be scanned rather than read. **A word you typed outranks the same letters buried
inside another name**, so `lim` puts *Mrs Lim Bee Leng* above *Mdm Halimah
Yusof*. The arrow at the right shows everyone if you would rather browse.

Arrow keys move through the matches, Enter chooses, Escape abandons what you
were typing. It is still a list, not free text: leaving the box with something
half-typed puts back whoever is actually chosen, so a namelist can never be
attached to a name that does not exist. The page remembers your choice for next
time, per folder.

### Undo

**Ctrl+Z**, or the ↶ button in the topbar. **Ctrl+Y** (or Ctrl+Shift+Z) redoes.
The button's tooltip names what will go — *Undo deleting the student(s)* — so
you can tell before pressing it.

It covers everything that changes the data: deletions, edits, merges of two
records, class rules, memberships, teacher changes, request decisions, level
updates and imports. Twenty steps are kept. Each one restores the whole picture,
so undoing a delete brings the student back *with* their class places, not as a
bare row.

Two deliberate limits:

- **Ctrl+Z inside a text box is the browser's own**, not the app's — you are
  asking to undo your typing, not the data. Undo also stays out of the way while
  a dialog is open.
- **It will not reach past another admin's work.** Every step is a snapshot of
  the whole model, so restoring one taken before their changes arrived would
  quietly revert them and then save that away. When a merge brings something in,
  the history is dropped and the button says why. Undo starts collecting again
  immediately.

Undo is a change like any other, so an undone step is saved (or autosaved) in
the normal way. For anything older than the history, `backups/` still holds a
copy of the workbook from every save.

### Splitting one allocation into two classes

Sometimes a single allocation is taught as two classes because of what else the
students take. **Sec 3 POA** is the case this was built for: POA and A Math are
timetabled together, so the one `POA G3` allocation becomes one class for those
who *also* take A Math and one for those who *do not*. (Sec 4 needs none of
this — there the subject group already says which class a student is in.)

In the class builder, open **More filters** and use the **Another subject**
branch: pick the column, then *also takes it* or *does not take it*. The count
under the map updates, the condition appears as a chip you can take off again,
and the suggested class name says which half it is — `Sec 3 POA G3 with AMATH`
and `Sec 3 POA G3 without AMATH`.

Both halves keep working on their own afterwards: a Sec 3 student who turns up
in a later school-file update taking POA but not A Math joins the "without"
class by themselves, exactly like any other rule.

The rule is stored as `POA=POA G3; !AMATH` — `!` before a column means *takes
nothing in it*. A class defined that way is still a POA class: naming A Math
says who is excluded, not that it teaches any, so it does not count as covering
A Math and a student taking A Math with no A Math class is still reported under
*Check these*.

### When the cell and the posting group disagree

The band written in a subject cell always wins over the one the posting group
would imply. A **PG1** student whose Science cell says `Sci PC G2` is in the
**G2** class — beside the PG2 students whose cell says only `Sci PC`, because
for them the band is read from their posting group. Only a cell that names no
band at all falls back to the PG.

So both office habits land in the same place:

| PG | Cell | Class |
|---|---|---|
| 1 | `Sci PC G2` | Sci PC **G2** — the cell said so |
| 1 | `Sci PC` | Sci PC **G1** — read from the PG |
| 2 | `Sci PC` | Sci PC **G2** — read from the PG |

### Opening a student

**Click a name in the Students tab** — or double-click anywhere on the row — and
that student opens. (Single-clicking elsewhere on a row still selects it for the
bulk actions, and the row's *Edit* link still works.)

Everything about them is in one window: their name, level, class, gender, PG,
TG/SG, and one row per subject.

**The name.** Typed in capitals as you go, because that is how a printed namelist
should read. When the school's file spells it differently, the window says so —
*The school file calls them "Aiden Lim". Your version is kept on every update* —
because the file's own spelling is what future imports match on, and it is kept
alongside your correction rather than replaced by it.

**The subjects.** Each column offers what that level actually uses (Sec 4's POA
options never appear under Sec 1), plus two ways out of that list:

- **Other…** on any subject lets you type the allocation as the file writes it —
  `HIST G3`, `SS/Geo`, `English Language - G2 - K200` — for a class this level has
  not used before. A band left out is still read from the student's PG.
- **Another subject** at the bottom adds a column this level does not use, or
  creates one that does not exist anywhere yet.

**The namelists follow.** Correcting a subject, band, PG, class or level is really
a statement about which classes the student belongs in, so when you press OK they
are added to every rule-built class they now match, and you are asked before they
come off any they no longer match. Classes with no rule are somebody's hand-picked
list and are never touched. This is the difference between fixing the data and
having to remember to fix the namelists too.

### Suggestions from teachers

The teachers are the ones who know that half a class is a colleague's, or that a
boy has been coming to lessons for a fortnight without appearing on the list. The
teacher page is read-only, and stays that way — what it gains is a way to *ask*.

**On the teacher page.** Every namelist has a **Suggest a change** button. With it
on, each row gets *Not in my class*, and a box under the table takes a full name
to add, with an optional reason. Nothing on the page changes: the suggestions
collect in a tray at the top of the page, where they can be removed again before
being sent.

**Getting it to the admin.** Teachers usually have read-only permission on the
shared folder — deliberately — so a suggestion travels as text. **Review and
send…** shows the whole message and offers three ways out:

- **Copy for email** — the normal route. Paste into an email or Teams.
- **Save as a file** — a `.txt` in their Downloads folder, to attach.
- **Save into the namelist folder** — writes into `requests\`, which only works
  where IT has made that one folder writable for teachers. Where it does, the
  admin never has to be emailed at all: the editor reads that folder on opening.

The message is readable at the top, so anyone can see what is being asked, and
carries the same content as a base64 block at the bottom. That block is what the
editor reads, and it survives being quoted, hard-wrapped and forwarded — which
plain JSON does not, because a line break inside a name would break it.

**On the admin page.** A **Requests** tab, with a red count when something is
waiting. Requests arrive by *Paste a request…*, *Open a request file…*, or from
the `requests\` folder. Every suggestion is a card naming the teacher, the class
and their reason.

An **add** offers two ways through:

- **Create the student…** opens the ordinary Add student form, with the teacher's
  spelling of the name in it, the class's level chosen, and the subject cell that
  class teaches already set. **Correct the spelling before pressing OK** — a
  teacher's "JASON LIM" becomes the office's "JASON LIM WEI HENG", and that is the
  name every future update matches on. They join the class automatically.
- **Could this be someone already on the roll?** lists students whose names look
  like the same person — the short-form case — so they are *put into the class*
  rather than created a second time. A shared surname alone is not treated as a
  match, or every Lim in the level would be offered.

A **remove** offers three, because "take them off" means different things:

- **Take off this class** — they stay on the roll and in their other classes.
- **Mark as left the school** — they are kept out of every class and every
  namelist. The school's file is read-only and still lists them, so this is
  recorded on the app's side and **survives a level refresh** — otherwise they
  would reappear the next morning. Reversible from the Students tab
  (*Left the school* in the filter → **Back on roll**). A student who was only
  ever entered in the app is simply deleted, since nothing outside knows of them.
- **Turn it down…** with a short reason.

Either way it is the admin's decision — a teacher's suggestion never changes the
data on its own. Decisions are kept, so the same request cannot be actioned twice,
and re-sending a list adds nothing. When the admin next saves, the teacher's page
shows what became of each suggestion — *accepted*, or *not taken up* with the
reason — and lets them clear it away.

### Checks the app runs for you

**Nobody missing from a namelist.** The app compares what each student takes
against the classes they are in, and reports allocations no class covers —
*"78 student(s) take GEOG G3 but are in no class for it"*. Each gap comes with
**Make a class for them** (opens the class dialog with that subject group
already ticked, those students already selected, and the class already named),
**Show the students**, or **Ignore**. A subject with no classes at all yet is
not reported: that is "not set up", not a gap.

**What the school's file changed.** Every refresh records what it did, student
by student — moved class, PG changed, TG/SG changed, subject group changed, new
in the file, no longer in the file. The update bar offers **What changed…**
(also a button in the School files tab), which lists them, filters by kind, and
copies the list so it can be pasted into an email to the teachers concerned.

### Two people editing at once

Two admins can have the folder open and work at the same time. There is no
server here, so nothing relays one person's keystrokes to the other — what there
is is a file both of them can see, and that turns out to be enough.

**Everything merges; only the same field clashes.** Every save, and every eight
seconds while the editor is open, the app compares three versions of the data:
what the file said when this page last read or wrote it (the common ancestor),
what is on screen now, and what the file says at this moment. A field only one
of you touched is taken from whoever touched it. So two admins on different
students, different classes, or even different fields of the *same* student all
land together with nothing to decide — the other person's work appears in your
page a few seconds after they save, with a line saying what arrived.

What genuinely cannot be decided by a machine is the same field changed by both
of you to different values. Those raise a bar at the top: *Another admin changed
something you also changed.* **Your version stays in effect and the editor is
never blocked** — click *Review them…* when you are ready, and each clash shows
the student or class, the field, and both values to choose between (with *Keep
all mine* / *Take all theirs* for a long list).

The rules underneath, for the cases that are not simple field edits:

| Situation | What happens |
|---|---|
| You each add a different student | Both are kept |
| You each add a student and the app gave both the same register id | Both are kept; yours is moved to the next free id, and its class memberships follow |
| One of you adds a student to a class | The addition applies for both |
| One of you removes a student from a class | The removal applies for both |
| One deletes a student the other only edited | **Nothing vanishes on a guess** — the student is kept and the deletion is offered in the review |
| One deletes a student nobody else touched | Deleted |
| You each add a teacher to the same class | The class ends up with both |
| One settles a teacher's request | It stays settled for both |

A backup of the version being replaced still goes into `backups/` on every save,
so the pre-merge state is always recoverable.

**Who else is in.** Each open editor drops a small note in `presence/` every
twenty seconds and reads everyone else's, so the topbar can say *Mrs Wong is
also editing*. It is not a lock — it is so two people about to work on the same
class can see each other first. Click it to set the name others see. Notes from
an editor that has been closed are ignored after 75 seconds and tidied away.

**Editing `namelist.xlsx` by hand in Excel** is still discouraged, but no longer
destructive: a change made outside the app is merged in like any other, rather
than being overwritten. The remaining reason to avoid it is that the app
regenerates `data.js` only when *it* saves, so a manual Excel edit leaves the
teacher page showing older data until an admin opens `admin.html` and saves.
View or print the workbook freely; make changes through the app.

**What this is not.** It is not Google Docs. You will not see the other person's
cursor, and their work reaches you when they save (or autosave, which is within
a few seconds of them stopping typing) rather than as they type. Getting closer
than that would mean putting the data behind a real server, which is a different
piece of software from a folder on a shared drive.

To try the teacher page locally: copy `sample/data.js` next to `dist/namelist.html`
and open it in a browser. The admin page can be exercised against a local folder
containing `sample/namelist.xlsx`.

### Data format

`namelist.xlsx` has three sheets, matched by header name (extra columns are ignored):

| Sheet | Columns |
|---|---|
| Students | StudentID, Name, Class, Level, Gender, PG, TG, SN, Origin, SourceName, Status, then one column per subject |
| Groups | GroupCode, GroupName, Subject, Teachers, Level, AutoMatch, AutoPG, AutoTG, AutoClasses |
| Teachers | Name |
| Subjects | Subject |
| Memberships | StudentID, GroupCode |
| Sources | Level, SourceFile, FilePattern, LastFile, LastImported, Mapping |
| Requests | RequestID, Made, Teacher, GroupCode, Action, StudentName, StudentID, Reason, Status, Decided, Note |

`Status` is either blank or `left` — see *Suggestions from teachers* below.

On the Students sheet, any header that isn't one of the fixed columns is treated as a
subject/band column holding that student's allocation (e.g. `EL G3`, `CL G2`) —
the same shape as the school's raw worksheet, so the saved file stays familiar.

A teacher's namelists = the members of every group whose Teacher field is their name.
