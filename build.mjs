#!/usr/bin/env node
// Builds the two self-contained pages into dist/.
// Local <script src> and <link rel="stylesheet"> references are inlined so the
// output files work offline with no neighbours except the data files.
// References to files that don't exist at build time (e.g. data.js, which the
// admin page generates at runtime) are left untouched.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const distDir = join(root, 'dist');

const PAGES = [
  { src: 'teacher.html', out: 'namelist.html' },
  { src: 'admin.html', out: 'admin.html' },
];

function inline(html, baseDir) {
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (tag, src) => {
    const path = resolve(baseDir, src);
    if (!existsSync(path)) return tag;
    const js = readFileSync(path, 'utf8').replace(/<\/script/gi, '<\\/script');
    return `<script>\n${js}\n</script>`;
  });
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (tag, href) => {
    const path = resolve(baseDir, href);
    if (!existsSync(path)) return tag;
    return `<style>\n${readFileSync(path, 'utf8')}\n</style>`;
  });
  return html;
}

mkdirSync(distDir, { recursive: true });
for (const { src, out } of PAGES) {
  const html = inline(readFileSync(join(srcDir, src), 'utf8'), srcDir);
  writeFileSync(join(distDir, out), html);
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  console.log(`built dist/${out} (${kb} KB)`);
}
