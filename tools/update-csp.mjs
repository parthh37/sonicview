// Keeps the Content-Security-Policy in sonicview.html in step with its inline <script> and <style>.
// The CSP allows only the inline blocks whose SHA-256 hashes it lists, so any edit to either block
// needs new hashes, or the browser refuses to run the app.
//
//   node tools/update-csp.mjs          rewrite the hashes in place
//   node tools/update-csp.mjs --check  exit 1 if the hashes are stale (run by CI)
//
// No dependencies, like the app itself.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../sonicview.html', import.meta.url));
const check = process.argv.includes('--check');
const html = readFileSync(file, 'utf8');
const fail = msg => { console.error(`update-csp: ${msg}`); process.exit(1); };

/* The browser hashes the element's text after the HTML parser has turned CRLF and CR into LF,
   so a Windows checkout with CRLF line endings must hash the same as the LF original. */
const hash = s => `'sha256-${createHash('sha256').update(s.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
/* Comments are matched whole so a "<script>" written inside one is skipped, and script/style bodies
   are matched whole (up to their end tag, as the HTML parser does) so a "<!--" inside one is too. */
const blocks = [...html.matchAll(/<!--[\s\S]*?-->|<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)]
  .filter(m => m[1]).map(m => ({ tag: m[1].toLowerCase(), attrs: m[2] || '', body: m[3], index: m.index }));
const of = tag => blocks.filter(b => b.tag === tag);
/* data blocks such as <script type="text/plain" id="sampleExp"> never run, so CSP does not cover them */
const runs = b => ['', 'text/javascript', 'application/javascript', 'module'].includes(/\btype\s*=\s*["']?([^"'\s>]*)/i.exec(b.attrs)?.[1].toLowerCase() ?? '');

if (of('script').some(b => /\bsrc\s*=/i.test(b.attrs))) fail('found a <script src>; SonicView must stay one self-contained file');
const want = { 'script-src': of('script').filter(runs).map(b => hash(b.body)), 'style-src-elem': of('style').map(b => hash(b.body)) };

const metaRe = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(">)/i;
const meta = metaRe.exec(html);
if (!meta) fail('no <meta http-equiv="Content-Security-Policy" content="..."> in sonicview.html');
/* a <meta> CSP only covers what the parser meets after it */
if (blocks.length && meta.index > blocks[0].index) fail('the CSP <meta> must come before the first <style> and <script>');

const directives = meta[2].split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]);
for (const name of Object.keys(want)) if (!directives.some(d => d[0] === name)) fail(`the CSP has no ${name} directive`);
/* the privacy promise: the page fetches and loads nothing. Loosening it should take a deliberate edit here too. */
for (const [name, value] of [['default-src', "'none'"], ['connect-src', "'none'"]])
  if (directives.find(d => d[0] === name)?.slice(1).join(' ') !== value) fail(`the CSP must keep ${name} ${value}`);

const policy = directives.map(([name, ...src]) =>
  [name, ...(name in want ? [...src.filter(s => !/^'sha(256|384|512)-/.test(s)), ...want[name]] : src)].join(' ')).join('; ');
if (policy === meta[2]) { console.log('CSP hashes in sonicview.html are up to date.'); process.exit(0); }

if (check) {
  console.error('CSP hashes in sonicview.html are stale. Run: node tools/update-csp.mjs\n' +
    `  in file:  ${meta[2]}\n  expected: ${policy}`);
  process.exit(1);
}
writeFileSync(file, html.replace(metaRe, (_, a, __, c) => a + policy + c));
console.log(`Updated the CSP in sonicview.html:\n  ${policy}`);
