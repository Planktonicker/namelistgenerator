# Third-party notices

This project bundles the following third-party software. Their licences are
their own and are **not** affected by the project's licence: nothing here
restricts what you may do with these components under their own terms.

## SheetJS (`xlsx`) 0.18.5

- Copyright (C) 2012-present SheetJS LLC
- <https://sheetjs.com> · <https://github.com/SheetJS/sheetjs>
- Licence: **Apache License 2.0** — full text in [`vendor/LICENSE-sheetjs.txt`](vendor/LICENSE-sheetjs.txt)

Reading and writing `.xlsx` is the whole reason this app can talk to the
office's files, and SheetJS is what does it. It is vendored at
`vendor/xlsx.full.min.js` and **inlined verbatim** into `dist/namelist.html` and
`dist/admin.html` by `build.mjs`, so those two files contain Apache-2.0 code.
The SheetJS copyright banner is inlined with it and must stay there.

If you redistribute the built pages, you are redistributing SheetJS, and
Apache-2.0 asks you to pass on this notice and a copy of that licence with them.

## Nothing else

No fonts, icons, frameworks or stylesheets are bundled. The pages use the
system font stack and their own CSS, which is why they open from a shared
drive with no network at all.
