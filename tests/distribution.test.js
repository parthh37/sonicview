'use strict';
/* sonicview.html must stay one self-contained file that works offline and sends nothing anywhere */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { HTML_PATH, inlineScripts, loadSonicView } = require('./helpers/harness');

const html = fs.readFileSync(HTML_PATH, 'utf8');

test('no external scripts, styles, fonts or images', () => {
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i, '<script src=...>');
  assert.doesNotMatch(html, /<link\b[^>]*\brel\s*=\s*["']?(stylesheet|preload|modulepreload|icon)\b[^>]*\bhref\s*=\s*["']?(https?:)?\/\//i, 'external <link>');
  assert.doesNotMatch(html, /@import\b/i, 'CSS @import');
  assert.doesNotMatch(html, /url\(\s*["']?(https?:)?\/\//i, 'CSS url() to another host');
  assert.doesNotMatch(html, /<(img|iframe|audio|video|source|embed|object)\b[^>]*\bsrc\s*=\s*["']?(https?:)?\/\//i, 'remote media');
});

test('the app code makes no network requests', () => {
  const code = inlineScripts(html).join('\n');
  for (const api of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bsendBeacon\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bimportScripts\b/, /\bimport\s*\(/]) {
    assert.doesNotMatch(code, api, String(api));
  }
});

test('the inline script runs with only a stub DOM (no errors at start-up)', () => {
  assert.doesNotThrow(() => loadSonicView());
});
