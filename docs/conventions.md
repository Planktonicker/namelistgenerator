# Conventions for next year

Two audiences. **Part 1** is for whoever prepares the level files — follow it and
the app needs no attention at all. **Part 2** is for the admin running
`admin.html`. **Part 3** is what to do when the year rolls over.

Nothing here is a hard requirement: the app is deliberately forgiving, and every
rule below has a fallback. They are the habits that keep it silent.

---

## Part 1 — the school's files

### The folder

- **One file per level**, all five in one folder. Any filename works; the app
  remembers which file is which level and follows it when the name changes
  (`Sec 3 Subject Grouping List_14 Jan.xlsx` → `…_5 Aug.xlsx` is recognised as
  the same list).
- Keep the level in the filename. `Sec 1 …`, `Sec 2 …` — that is what makes a
  renamed file recognisable.
- **Move superseded versions to an archive subfolder.** If two files could be
  the same level, the app takes the most recently modified one, which is
  usually right and occasionally not.
- The app **only ever reads** this folder — the permission it asks Chrome for is
  read-only. Nothing it does can change these files.

### The sheet

- **One header row.** Titles, dates and notes above it are fine — the real
  header row is found automatically.
- **No merged cells in the header row**, and no data column left without a
  heading.
- One row per student. Blank rows are skipped; a row with no name is reported.

### The columns

Recognised automatically under any of these names. If a file calls something
else, the admin points at the right column once in the import review and the
choice is remembered.

| What | Headings recognised | Notes |
|---|---|---|
| Serial number | `S/N`, `No` | Printed on every namelist — worth keeping |
| Name | `Name`, `Student Name`, `Full Name` | **The matching key.** See below |
| Class | `Class`, `Class Name`, `Class 2026`, `Form Class` | |
| Level | `Level`, `Year` | Optional — the app stamps the level being imported |
| Gender | `Gender`, `Sex` | Printed on namelists |
| Posting group | `PG`, `Posting Group` | **1, 2 or 3** |
| Tutorial / subject group | `TG`, `SG`, `Sub Group`, `Tutorial Group`, `Subject Group` | |
| Register number | `Reg#`, `Reg No` | Optional; makes student IDs stable |
| Subjects | `EL`, `MTL`, `MA`, `SCI`, `HIST`, `HUM`, `POA`, … | One column per subject |
| Numbered slots | `Sub 5`, `Sub 6`, `Sub 7`, `Subject 1 … 20` | The subject is named in the cell |
| Ignored | `PSLE …`, `Remarks`, `Note` | Left out of the app by default |

### Names — the one thing worth being strict about

Students are matched **by name** every time a level is refreshed. That is how a
student keeps their ID, their classes and anything the admin edited.

- **Full name, in capitals, spelt the same way every time.** `TAN WEI MING`,
  not `Tan Wei Ming` one term and `Tan Wei Ming (Nathan)` the next.
- A changed spelling is usually absorbed (word order, an added name, a changed
  class are all handled), but a genuine rewrite produces a *possible duplicate*
  warning for the admin to merge. Fewer rewrites, fewer warnings.
- S/N and register numbers may change freely — matching does not depend on them.

### Posting group

- **Write 1, 2 or 3.** `PG1`, `PG 2`, `P.G.3` are all read as the number.
- **Do not leave it blank.** A blank PG is the one case where a subject cell
  without a band cannot be resolved (see below).

### Subject cells — bands and spelling

The app reads a cell as a **subject plus a band**. The band is whatever the cell
says; if the cell says nothing, it is taken from the student's posting group.

| PG | Cell | Read as |
|---|---|---|
| 3 | `SS/Hist` | History **G3** |
| 3 | `SS/Hist G3` | History **G3** — the same class |
| 2 | `SS/Hist G3` | History **G3**, above their posting group |
| 2 | `SS/Hist` | History **G2** |

So both habits work. Still, two conventions make the printout read better:

- **Write the band whenever you can** — `SS/Hist G3` rather than `SS/Hist`. It
  removes any doubt, and it is the only way a student with no PG can be placed.
- **Pick one spelling per subject and keep it.** `SS/Hist`, `SSHist` and
  `SS Hist` are folded into one class, but the label printed on the namelist is
  whichever spelling appears most often — so a consistent file gives a tidy
  printout.
- **One subject per cell.** Two in a cell cannot be split; use the numbered
  slots, where a subject may sit under `Sub 5` for one student and `Sub 7` for
  the next without any trouble.
- **Leave a cell blank** rather than writing `N/A`, `NIL`, `-` or `0`. Those are
  flagged as placeholders and held back from becoming classes.
- Ministry-coded cells (`English Language - G2 - K200`) name their class
  outright and are used exactly as written — no band is inferred.

### Tutorial / subject groups

- One convention per level: `SG1 … SG6`, or `TG1/TG2`, or the school's combined
  form (`3 A/BC`). Spacing and case are normalised (`SG 3` → `SG3`).
- If the group code already carries the posting group (`3 A` = PG 3, group A),
  keep it — the namelist banner reads it as `PG 3 A` rather than repeating it.

### What pauses the automatic update

The app refreshes every level by itself when the editor is opened. Two things
stop it and ask for the admin:

1. **A column appeared, vanished or was renamed.** That is a decision, not a
   refresh, so the level is skipped and flagged. Tell the admin when a file's
   shape changes.
2. **The folder permission has lapsed** — which it does every time the browser
   is restarted. Press Enter on the start screen and it is back.

Office lock files (`~$…`) are ignored, so a file open in Excel is not mistaken
for a namelist.

---

## Part 2 — the admin, in the app

- **Teachers first.** Paste the staff list once at the start of the year
  (Teachers → *Paste list…*), then give each of them their classes from their
  own row. Rename a teacher there and every class follows.
- **Let the data make the classes.** *Find classes in the data* creates one
  class per teaching group the files already contain. Columns that are not
  allocations are held back under *Check these* for you to accept or ignore.
- **Build the rest on the map**, top down: level → subject → group → TG/SG.
  Answering higher up clears what hung below, and *Clear the map* starts again.
  PG lives behind *More filters* because the subject group usually implies it.
- **Teachers find themselves by typing.** The name box on `namelist.html` takes
  any part of a name and narrows the list as they go — no scrolling a hundred
  names. Arrow keys and Enter work; half-typed text is never accepted.
- **Ctrl+Z undoes.** Twenty steps back, covering anything that changes the
  data — a deletion brings the student back with their class places. The ↶
  button in the topbar names what it will undo before you press it. It stops at
  the point another admin's changes were merged in, and says so.
- **Click a student's name** in the Students tab to open them — name, class, PG,
  TG/SG and every subject in one window. Fixing a subject or a band moves them
  between namelists straight away: they join the classes they now match, and you
  are asked before they come off any they no longer do. If the allocation you
  need is not in the list, pick **Other…** and type it as the file writes it.
- **One allocation, two classes.** Where a subject is timetabled against
  another — Sec 3 POA against A Math — open *More filters* → **Another
  subject** and pick *also takes it* / *does not take it*. That gives
  `POA G3 with AMATH` and `POA G3 without AMATH`, each keeping itself up to
  date. Sec 4 needs none of this: there the subject group already says which
  class a student is in.
- **The default class.** A class can be built from what its students do *not*
  take: lower secondary **G1 HEMS** is every PG 1 student except those given a
  humanities subject at G2 or G3. Under *More filters* → **Another subject**,
  pick the column, press **not above** and choose **G1** — once for `HIST`,
  once for `GEOG`, once for `LIT`. A blank column counts as "not above", and a
  cell with no band written in it is read at the student's posting group, so a
  PG 1 student whose cell says only `SS/Hist` stays in HEMS. Name it yourself:
  a class with no subject of its own is only suggested as `Sec 1 PG1`.
- **The teacher box in a class starts blank.** Pick a name and press **Add** —
  or just press **OK**, which takes the name showing in the box with it.
- **Trim by hand in the class dialog.** Half a class shared with a colleague is
  27 matched, four unticked, 23 on the namelist — and the unticked stay out when
  the rule is applied again.
- **Watch *Check these***. It reports students who take a subject with no class
  for it, columns that look mislabelled, and possible duplicate students.
- **Read *What changed…*** after an update — moved class, changed band, new
  student, gone from the file — and copy the list into an email if teachers need
  to know.
- **Clear the *Requests* tab.** Teachers send suggestions from their own page —
  someone to add, someone who is not in their half of a shared class. A red count
  means someone is waiting. Accepting an *add* opens the usual student form with
  their name in it: **correct the spelling to the office's version before pressing
  OK**, because that is what future updates match on. If the name looks like
  somebody already on the roll, put that student in the class rather than creating
  a second record for the same child.
- **"Mark as left the school" is not a delete.** The school's file still lists
  them and the app never writes to it, so the leaver is recorded on the app's side
  and held out of every namelist — including after a refresh. Undo it under
  Students → *Left the school* → **Back on roll**.
- **Opening the app is two keys.** The start screen asks to reconnect to the
  folder every time the browser is restarted — a browser rule for a page opened
  from a drive, not a setting. The button is already focused, so **Enter** (or a
  click anywhere) is enough.
- **Autosave is on**, four seconds after you stop typing. The topbar says
  *Saved 09:51 AM*.
- **Two of you can work at once.** The other admin's changes appear in your page
  within a few seconds of them saving, and yours in theirs — different students,
  different classes, even different fields of one student all merge with nothing
  to decide. The topbar names anyone else who has the folder open. Only the same
  field changed by both of you raises a bar: *Review them…* shows both versions,
  yours staying in effect until you choose. Nothing is blocked while it waits.
- **Save.** Teachers see the update the next time they open the page. Pressing
  Save yourself also takes a backup, which an autosave only does once an hour.
- **Added students** are for genuine late arrivals. They are kept when a level
  refreshes and adopted automatically once the office lists them.

---

## Part 3 — rolling over to a new year

The cleanest way, and the one to plan for:

1. **Archive this year.** Copy the whole `Namelist` folder to
   `Namelist 2026 (archive)`. Nothing is lost, and last year's namelists stay
   printable.
2. **Start the new year empty.** Delete `namelist.xlsx` and `data.js` from the
   working folder (or make a fresh folder with the two HTML files) and open
   `admin.html`. It offers the level files walkthrough on first run.
3. **Point the five levels at the new files** — Sec 1 to Sec 5 in turn. Each is
   imported, and the column review appears once per level so you can confirm
   what it found.
4. **Paste the staff list**, run *Find classes in the data*, and give teachers
   their classes.
5. **Copy `namelist.html` and `admin.html`** from `dist/` if a newer build
   exists, and keep the teacher shortcut pointing at `namelist.html`.

Each copy of `admin.html` remembers its own data folder, so the new year's copy
opens asking which folder to use rather than quietly saving into last year's.
The first time you open it, choose the new folder.

If you ever open a folder that has the pages but no `namelist.xlsx`, the setup
screen offers **Use an existing namelist.xlsx…** — point it at the old folder's
workbook and press Save, and this folder gets its own copy. If the workbook is
lost but a `data.js` is still there, **Rebuild from the data.js here** brings the
students and classes back (the School files settings have to be redone).

Keeping last year's `namelist.xlsx` and re-pointing the levels at new files also
works — students are matched by name and moved to their new class and level —
but the teaching classes from last year would then need clearing out by hand.
For a whole new cohort, starting clean is less work.
