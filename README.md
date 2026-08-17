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

**Reconnecting.** Chrome/Edge remember both folders between sessions, so after
the first time the start screen offers **Reconnect to “…”** — a single
permission click instead of navigating the shared drive again. The School files
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

- **Teachers:** double-click the shortcut → **pick your name from the list** → your
  classes appear as chips; click one to see just that namelist, or leave it on *All*
  to see them all. **Print** any single class or all of them; printouts carry a
  Remarks column for marking. The second tab, **All classes**, lists every class in
  the school with filters for level, subject and teacher — useful when covering a
  colleague — and its search box also accepts a student's name, which brings back
  the classes that student is in.
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
test/auto-update.browser.mjs  opening the editor refreshes levels by itself
test/class-dialog.browser.mjs  teacher roster + building a class from criteria
test/edit-class.browser.mjs    editing a class re-applies its rule; members untick
test/coverage-changes.browser.mjs  coverage gaps, the change report, pasted staff
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
classes after the fact: pick the **subject** (and level, if there is more than
one), and every class of that subject is listed with a tick box and its size —
tick what they take, untick to drop their name. It opens on the subject they
already teach, and says what they will be teaching before you press OK.
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
| **Members** | everyone currently on the namelist, each with a tick — untick anyone who should not be there |

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
| Groups | GroupCode, GroupName, Subject, Teachers, Level, AutoMatch, AutoPG, AutoClasses |
| Teachers | Name |
| Memberships | StudentID, GroupCode |
| Sources | Level, SourceFile, FilePattern, LastFile, LastImported |

On the Students sheet, any header that isn't one of the fixed five is treated as a
subject/band column holding that student's allocation (e.g. `EL G3`, `CL G2`) —
the same shape as the school's raw worksheet, so the saved file stays familiar.

A teacher's namelists = the members of every group whose Teacher field is their name.
