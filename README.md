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
3. No `namelist.xlsx` yet? Choose **Import a raw document…** and point it at your
   existing student list (Excel/CSV). The importer:
   - finds the real header row automatically, even below titles/dates;
   - auto-matches Name / Class / Gender / PG columns (correct them in the dialog if needed);
   - generates student IDs from class + row order (`1R1-01`, `1R1-02`, …) when the
     file has no unique ID column, keeping register order;
   - keeps the remaining columns (TG, EL, MT, HMT, MA, SCI, HIST, GEOG, LIT, …) as
     **subject/band columns** — sortable and searchable per student; untick any you
     don't want (PSLE/remark columns are unticked by default).
4. Create teaching groups and fill them: in the **Students** tab, filter or search
   (e.g. class `1R1`, or tag `MA G3`), click rows / Shift-click a range / tick the
   header checkbox, then **Add to group** — straight into an existing group or a new
   one. Then press **Save**.
5. Make a desktop shortcut for teachers (see below).

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
```

Requires only Node (no npm packages):

```
node test/roundtrip.test.cjs   # data-layer tests
node tools/gen-sample.cjs      # regenerate sample/namelist.xlsx + sample/data.js
node build.mjs                 # rebuild dist/
```

To try the teacher page locally: copy `sample/data.js` next to `dist/namelist.html`
and open it in a browser. The admin page can be exercised against a local folder
containing `sample/namelist.xlsx`.

### Data format

`namelist.xlsx` has three sheets, matched by header name (extra columns are ignored):

| Sheet | Columns |
|---|---|
| Students | StudentID, Name, Class, Gender, PG, then one column per subject/band (EL, MT, MA, …) |
| Groups | GroupCode, GroupName, Subject, Teacher |
| Memberships | StudentID, GroupCode |

On the Students sheet, any header that isn't one of the fixed five is treated as a
subject/band column holding that student's allocation (e.g. `EL G3`, `CL G2`) —
the same shape as the school's raw worksheet, so the saved file stays familiar.

A teacher's namelists = the members of every group whose Teacher field is their name.
