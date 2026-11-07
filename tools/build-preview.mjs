// node tools/build-preview.mjs <repo> <out.html>: bundles the app into one file for the preview.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , repo = '.', out = 'preview.html'] = process.argv;
const html = readFileSync(join(repo, 'index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="module"'));
const fonts = /<link rel="stylesheet" href="https:\/\/fonts[^>]+>/.exec(html)[0];
let css = ['tokens', 'base', 'screens', 'theme', 'budget'].map(n => readFileSync(join(repo, 'css', `${n}.css`), 'utf8')).join('\n');
// Claude's viewer can force light or dark with data-theme, so honor it as well as the system setting.
const start = css.indexOf('@media (prefers-color-scheme: dark) {');
const darkBody = css.slice(css.indexOf(':root {', start) + 7, css.indexOf('}\n}', start));
css = css.replace('@media (prefers-color-scheme: dark) {\n  :root {', '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {');
css += `\n:root[data-theme="dark"] {${darkBody}}\n`;
// The viewer already pads the top of the page for the phone's status bar.
css = css.replace('padding-block:env(safe-area-inset-top,0px) calc(', 'padding-block:0 calc(');
const result = await build({
  entryPoints: [join(repo, 'js/main.js')], bundle: true, format: 'iife', write: false, target: 'safari14', legalComments: 'none',
  define: { 'globalThis.__WMM_PREVIEW__': 'true' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
writeFileSync(out, `<title>Where's my money</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${fonts}\n<style>${css}</style>\n${body}\n<script>${js}</script>\n`);
console.log(`Wrote ${out}`);
