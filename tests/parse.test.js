'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, plain, eq } = require('./helpers/harness');
const { exp, office } = require('./helpers/exp');

const sv = loadSonicView();
const parse = text => plain(sv.parseExp(text));

test('parseExp: plain key=value text, URL-decoded', () => {
  eq(parse('a=1&b=hello%20world&c='), new Map([['a', '1'], ['b', 'hello world'], ['c', '']]));
});

test('parseExp: a key with no "=" gets an empty value; "=" inside a value is kept', () => {
  eq(parse('a=1&flag&url=x%3Dy=z'), new Map([['a', '1'], ['flag', ''], ['url', 'x=y=z']]));
});

test('parseExp: ignores surrounding whitespace, empty parts and trailing &', () => {
  eq(parse('\n  a=1&&b=2&&\n'), new Map([['a', '1'], ['b', '2']]));
});

test('parseExp: the last copy of a repeated key wins', () => {
  assert.equal(parse('a=1&a=2').get('a'), '2');
});

test('parseExp: bad percent-escapes fall back to unescape()', () => {
  const kv = parse('pct=100%&latin=%E9t%E9');
  assert.equal(kv.get('pct'), '100%');
  assert.equal(kv.get('latin'), 'été');
});

test('parseExp: base64 export (wrapped lines, trailing &&) matches the plain text', () => {
  const e = office().host('Web Server', '192.168.10.20').rule({ from: 'WAN', to: 'LAN', dst: 'Web Server', svc: 'HTTPS', comment: 'web & mail' });
  eq(parse(e.base64()), e.map());
  eq(parse(e.base64({ wrap: 0 })), e.map());
  eq(parse(e.text()), e.map());
});

test('parseExp: base64 with the "=" padding stripped still decodes', () => {
  const e = exp().set('shortProdName', 'TZ').set('k', 'v');
  const b64 = Buffer.from(e.text()).toString('base64');
  assert.match(b64, /=$/, 'fixture should need padding');
  eq(parse(b64.replace(/=+$/, '')), e.map());
});

test('parseExp: rejects files that are not exports', () => {
  const notExport = /does not look like a SonicWall \.exp export/;
  assert.throws(() => sv.parseExp(''), notExport);
  assert.throws(() => sv.parseExp('<!doctype html><html></html>'), notExport);
  assert.throws(() => sv.parseExp('{"zones":[]}'), notExport);
  /* valid base64 that decodes to something other than key=value text */
  assert.throws(() => sv.parseExp(Buffer.from('just some text').toString('base64')), notExport);
  assert.throws(() => sv.parseExp('hello world'), notExport);
});

test('parseExp: rejects base64 that cannot be decoded', () => {
  /* 1 or 5 base64 characters can never be valid, even with padding added */
  assert.throws(() => sv.parseExp('A'), /could not be decoded/);
  assert.throws(() => sv.parseExp('abcde'), /could not be decoded/);
});
