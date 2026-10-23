'use strict';
/* the built-in sample (tools/make-sample.mjs) is there to show off every check, so it must keep doing that */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { HTML_PATH, loadSonicView, eq } = require('./helpers/harness');

const sv = loadSonicView();
const html = fs.readFileSync(HTML_PATH, 'utf8');
const block = /<script type="text\/plain" id="sampleExp">([^<]*)<\/script>/.exec(html);

test('the sample is embedded and parses', () => {
  assert.ok(block, '<script type="text/plain" id="sampleExp"> in sonicview.html');
  assert.ok(sv.parseExp(block[1]).size > 500);
});

test('the sample trips every rule problem exactly once', () => {
  sv.load(sv.parseExp(block[1]));
  eq(sv.ruleProblems().map(p => [p.sev, p.kind, p.rule ? 'rule #' + p.rule.n : 'NAT #' + p.nat.n]), [
    ['High', 'Wide open from internet', 'rule #8'],
    ['High', 'Block never works', 'rule #9'],
    ['High', 'Risky port open to internet', 'rule #10'],
    ['Medium', 'Duplicate rule', 'rule #4'],
    ['Medium', 'Port forward with no allow rule', 'NAT #5'],
    ['Medium', 'Allow never works', 'rule #13'],
    ['Medium', 'Allows everything', 'rule #14'],
    ['Low', 'Never used (same result)', 'rule #2'],
    ['Low', 'Uses a missing object', 'rule #5'],
    ['Info', 'Turned off', 'rule #11'],
  ]);
});

test('the sample has unused objects to show', () => {
  sv.load(sv.parseExp(block[1]));
  const u = sv.unusedObjects(), mine = o => (+o.props & 0xFFFF) === 14;
  eq(u.addrs.filter(mine).map(o => o.name), ['Test Laptop', 'Front Desk Printer', 'Printers']);
  eq(u.svcs.filter(mine).map(o => o.name), ['Custom App 9000']);
});

test('the sample uses only documentation and private IP ranges', () => {
  const doc = /^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/;
  const priv = /^(10\.\d+|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/;
  const special = /^(0\.0\.0\.0|255\.\d+\.\d+\.\d+)$/; // "none" and netmasks
  for (const [k, v] of sv.parseExp(block[1])) {
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(v)) continue;
    assert.ok(doc.test(v) || priv.test(v) || special.test(v), `${k}=${v}`);
  }
});
