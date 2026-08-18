# Contributing

Bug reports and fixes are welcome. The app runs a Singapore secondary school's
namelists, so the bar is "does it hold up on a Monday morning" rather than
anything grander.

## Before you start

- **Open an issue first** for anything more than a small fix. Much of what
  looks like a missing feature is a deliberate constraint — the pages have to
  work from a shared drive, offline, with no server and no install.
- **The school's own files are read-only.** The app opens that folder with
  read permission and writes only inside its own data folder. Nothing that
  changes this will be merged.

## Running it

```sh
node build.mjs                 # rebuild dist/ — always commit dist/ with src/
node test/roundtrip.test.cjs   # data layer
for t in test/*.browser.mjs; do node "$t"; done   # needs Playwright + Chromium
```

`dist/` is checked in on purpose: it is what gets copied onto the shared drive,
so a change that is not built is a change that has not shipped.

## What a good change looks like

- A test alongside it. `test/` has a suite per area; add to the closest one.
- Comments that say *why*, not what. The code is read by whoever inherits this
  in three years.
- `README.md` and `docs/conventions.md` updated if the change is visible to an
  admin or a teacher.

## Licensing your contribution

The project is under the [PolyForm Noncommercial 1.0.0](LICENSE) licence, and
commercial licences are sold separately. So that this stays possible:

> By opening a pull request you confirm that you wrote the contribution or
> otherwise have the right to submit it, and you grant Cheng Xin Ze a
> perpetual, worldwide, irrevocable, royalty-free licence to use, modify and
> distribute it, **including under licence terms other than the project's own**
> — which is what lets a commercial licence cover the whole codebase rather
> than the parts one person happened to write.

You keep the copyright in what you wrote. If you would rather not grant that,
say so in the pull request; the change may still be useful as a description of
the problem, and it can be reimplemented.
