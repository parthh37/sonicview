'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { office } = require('./helpers/exp');

const sv = loadSonicView();

/* office network plus a few objects most rule tests use */
function base() {
  return office()
    .host('PC', '192.168.10.50')
    .network('LAN Net', '192.168.10.0', '255.255.255.0')
    .host('DMZ Web', '172.16.5.20', { zone: 'DMZ' })
    .network('DMZ Net', '172.16.5.0', '255.255.255.0', { zone: 'DMZ' })
    .service('Wide', 'TCP', 1000, 2000)
    .schedule('Work Hours');
}

/** load the export and list its problems as [severity, kind, rule #, other rule #] */
function problems(e, { kinds } = {}) {
  sv.load(e.map());
  return sv.ruleProblems()
    .filter(p => !kinds || kinds.includes(p.kind))
    .map(p => [p.sev, p.kind, p.rule?.n ?? null, p.other?.n ?? null]);
}
const SHADOW = ['Duplicate rule', 'Never used (same result)', 'Block never works', 'Allow never works'];
const shadows = e => problems(e, { kinds: SHADOW });

/* ---------- duplicates and shadowing ---------- */

test('Duplicate rule: same zones, objects, action, schedule and users', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTPS' });
  eq(shadows(e), [['Medium', 'Duplicate rule', 2, 1]], 'reported once, not also as "never used"');
});

test('Duplicate rule: not across zone pairs, and not with a disabled copy', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS', enabled: false });
  eq(shadows(e), []);
});

test('Never used (same result): an earlier rule with the same action covers it', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Net' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTPS' });
  eq(shadows(e), [['Low', 'Never used (same result)', 2, 1]]);
});

test('Block never works: an earlier allow covers a later deny or discard', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Net', svc: 'Web' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS', action: 'Discard' });
  eq(shadows(e), [['High', 'Block never works', 2, 1], ['High', 'Block never works', 3, 1]]);
});

test('Allow never works: an earlier block covers a later allow', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', src: 'LAN Net', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTPS' });
  eq(shadows(e), [['Medium', 'Allow never works', 2, 1]]);
});

test('Deny and Discard count as the same result', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', action: 'Deny', svc: 'RDP' })
    .rule({ from: 'LAN', to: 'DMZ', action: 'Discard', svc: 'RDP' });
  eq(shadows(e), [['Low', 'Never used (same result)', 2, 1]]);
});

test('Shadowing: only the first covering rule is named', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Net' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Web' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny' });
  eq(shadows(e), [['High', 'Block never works', 3, 1], ['Low', 'Never used (same result)', 2, 1]]);
});

test('Shadowing: partial cover is not reported', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Web', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'LAN Net', svc: 'Web' });
  eq(shadows(e), []);
});

test('Shadowing: disabled rules never hide later rules', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', action: 'Deny', enabled: false })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' });
  eq(shadows(e), []);
});

test('Shadowing: rules in other zone pairs never hide each other', () => {
  const e = base()
    .rule({ from: 'WAN', to: 'DMZ', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' });
  eq(shadows(e), []);
});

test('Shadowing: several earlier rules that together cover a rule', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Web', action: 'Deny' });
  eq(shadows(e).map(p => p.slice(0, 3)), [['High', 'Block never works', 3]]);
});

test('Shadowing: a set of rules is named in the why text; rules that add nothing are left out', () => {
  sv.load(base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Net', svc: 'HTTP' }) /* HTTP again: #1 already takes it */
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'SSH' })  /* covers src and dst, but no Web port */
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Web', action: 'Deny' })
    .map());
  const [p] = sv.ruleProblems();
  eq([p.kind, p.rule.n, p.other.n, p.others.map(r => r.n)], ['Block never works', 5, 1, [1, 4]]);
  assert.match(p.why, /^Rules #1 and #4 are checked first and together allow all of this traffic\./);
});

test('Shadowing: source or destination addresses add up too, merged like addrCovers', () => {
  const e = base()
    .host('PC2', '192.168.10.51')
    .range('PCs', '192.168.10.50', '192.168.10.51')
    .host('DMZ Web2', '172.16.5.21', { zone: 'DMZ' })
    .range('DMZ Webs', '172.16.5.20', '172.16.5.21', { zone: 'DMZ' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC2', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PCs', dst: 'DMZ Web', svc: 'SSH' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'DMZ Web' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'DMZ Web2' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'DMZ Webs', svc: 'HTTPS' });
  eq(shadows(e).map(p => p.slice(0, 3)), [['Medium', 'Allow never works', 3], ['Low', 'Never used (same result)', 6]]);
});

test('Shadowing: sets that mix allow and block, or that miss the schedule, are not added up', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Web', action: 'Discard' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'PC', svc: 'HTTP', sched: 'Work Hours' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'PC', svc: 'HTTPS' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'PC', svc: 'Web', action: 'Deny' });
  eq(shadows(e), []);
});

test('Shadowing: one covering rule is named on its own, even when a set before it covers too', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Net' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'Web', action: 'Deny' });
  eq(shadows(e), [['High', 'Block never works', 4, 3]]);
});

/* ---------- the default rule is checked last ---------- */

test('Default rule: an auto Any/Any/Any rule listed first is still checked last', () => {
  const e = base()
    .rule({ from: 'WAN', to: 'DMZ', action: 'Deny', auto: true })
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'WAN', auto: true })
    .rule({ from: 'LAN', to: 'WAN', src: 'PC', action: 'Deny' });
  eq(shadows(e), []);
});

test('Default rule: a later Any/Any/Any rule made by hand covers the default', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', action: 'Deny', auto: true })
    .rule({ from: 'LAN', to: 'DMZ' });
  /* checked order is #2 then #1, so the default deny never fires */
  eq(shadows(e), [['High', 'Block never works', 1, 2]]);
});

test('Default rule: only auto rules with Any source, destination and service move to the end', () => {
  const e = base()
    /* auto, but with a service: stays where it is */
    .rule({ from: 'LAN', to: 'DMZ', svc: 'HTTPS', auto: true })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS', action: 'Deny' })
    /* made by hand Any/Any/Any: stays first */
    .rule({ from: 'DMZ', to: 'LAN', action: 'Deny' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'PC', svc: 'SSH' });
  eq(shadows(e), [['High', 'Block never works', 2, 1], ['Medium', 'Allow never works', 4, 3]]);
});

test('isDefaultRule', () => {
  sv.load(base()
    .rule({ from: 'LAN', to: 'WAN', auto: true })
    .rule({ from: 'LAN', to: 'WAN' })
    .rule({ from: 'LAN', to: 'WAN', svc: 'DNS', auto: true })
    .map());
  eq(sv.model().rules.map(sv.isDefaultRule), [true, false, false]);
});

/* ---------- schedule and user exceptions ---------- */

test('Schedule: an earlier rule with a schedule does not always apply, so it hides nothing', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', sched: 'Work Hours' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny' });
  eq(shadows(e), []);
});

test('Schedule: same schedule, or an earlier rule with no schedule, still hides', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', sched: 'Work Hours' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny', sched: 'Work Hours' })
    .rule({ from: 'DMZ', to: 'LAN' })
    .rule({ from: 'DMZ', to: 'LAN', dst: 'PC', svc: 'SSH', action: 'Deny', sched: 'Work Hours' });
  eq(shadows(e), [['High', 'Block never works', 2, 1], ['High', 'Block never works', 4, 3]]);
});

test('Users: an earlier rule for some users only hides rules for the same users', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', whom: 'Sales' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS', action: 'Deny', whom: 'Sales' });
  eq(shadows(e), [['High', 'Block never works', 3, 1]]);
});

test('Users: whom "0" means everyone', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', whom: '0' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTP', action: 'Deny', whom: 'Sales' });
  eq(shadows(e), [['High', 'Block never works', 2, 1]]);
});

/* ---------- rules that open too much ---------- */

test('Wide open from internet: inbound allow on every port with Any source or destination', () => {
  const e = base()
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web' })
    .rule({ from: 'WAN', to: 'LAN', src: '198.51.100.9' })
    .rule({ from: 'WAN', to: 'DMZ', src: '198.51.100.9', dst: 'DMZ Web' }) /* both pinned: not flagged */
    .rule({ from: 'WAN', to: 'WAN' }) /* not inbound */
    .rule({ from: 'WAN', to: 'LAN', action: 'Deny' });
  eq(problems(e, { kinds: ['Wide open from internet'] }), [['High', 'Wide open from internet', 1, null], ['High', 'Wide open from internet', 2, null]]);
});

test('Risky port open to internet: inbound allow from Any to a risky or wide service', () => {
  const e = base()
    .rule({ from: 'WAN', to: 'LAN', dst: 'PC', svc: 'RDP' })
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'Wide' })
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'WAN', to: 'LAN', src: '198.51.100.9', dst: 'PC', svc: 'RDP' })
    .rule({ from: 'WAN', to: 'LAN', dst: 'PC', svc: 'RDP', enabled: false });
  sv.load(e.map());
  const got = sv.ruleProblems().filter(p => p.kind === 'Risky port open to internet');
  eq(got.map(p => p.rule.n), [1, 2]);
  assert.match(got[0].why, /RDP/);
  assert.match(got[1].why, /Wide port range/);
});

test('Allows everything: zone-to-zone Any/Any/Any allow made by hand', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ' })
    .rule({ from: 'DMZ', to: 'LAN', auto: true }) /* firewall default: not flagged */
    .rule({ from: 'LAN', to: 'WAN' })             /* internet access is normal */
    .rule({ from: 'LAN', to: 'MULTICAST' })
    .rule({ from: 'LAN', to: 'LAN' })             /* same zone */
    .rule({ from: 'DMZ', to: 'LAN', action: 'Deny' });
  eq(problems(e, { kinds: ['Allows everything'] }), [['Medium', 'Allows everything', 1, null]]);
});

/* ---------- other checks ---------- */

test('Uses a missing object: unknown address or service names; bare IPs are fine', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', src: 'Ghost', dst: '172.16.5.9', svc: 'No Such Service' })
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', dst: 'DMZ Web', svc: 'HTTPS' });
  sv.load(e.map());
  const got = sv.ruleProblems().filter(p => p.kind === 'Uses a missing object');
  eq(got.map(p => [p.sev, p.rule.n]), [['Low', 1]]);
  assert.match(got[0].why, /Ghost, No Such Service/);
});

test('Turned off: disabled rules made by hand are Info; disabled auto rules are ignored', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', svc: 'SSH', enabled: false })
    .rule({ from: 'LAN', to: 'DMZ', svc: 'RDP', enabled: false, auto: true });
  eq(problems(e, { kinds: ['Turned off'] }), [['Info', 'Turned off', 1, null]]);
});

test('Problems are sorted by severity, then rule number', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', svc: 'SSH', enabled: false }) /* 1: turned off */
    .rule({ from: 'LAN', to: 'DMZ', src: 'Ghost' })               /* 2: missing object */
    .rule({ from: 'WAN', to: 'LAN', dst: 'PC', svc: 'RDP' })      /* 3: risky port */
    .rule({ from: 'LAN', to: 'DMZ', src: 'Ghost' });              /* 4: duplicate of 2, missing object */
  eq(problems(e), [
    ['High', 'Risky port open to internet', 3, null],
    ['Medium', 'Duplicate rule', 4, 2],
    ['Low', 'Uses a missing object', 2, null],
    ['Low', 'Uses a missing object', 4, null],
    ['Info', 'Turned off', 1, null],
  ]);
});

test('mainProblems hides Info items and problems on auto-added rules', () => {
  const e = base()
    .rule({ from: 'LAN', to: 'DMZ', svc: 'SSH', enabled: false })
    .rule({ from: 'LAN', to: 'DMZ', action: 'Deny', auto: true })
    .rule({ from: 'LAN', to: 'DMZ' })
    .rule({ from: 'WAN', to: 'LAN', dst: 'PC', svc: 'RDP' });
  sv.load(e.map());
  const all = sv.ruleProblems().map(p => p.kind);
  assert.ok(all.includes('Turned off') && all.includes('Block never works'), 'fixture produces Info and auto-rule problems');
  eq(sv.mainProblems().map(p => [p.kind, p.rule.n]), [['Risky port open to internet', 4], ['Allows everything', 3]]);
});

test('ruleProblems is cached per model', () => {
  sv.load(base().rule({ from: 'LAN', to: 'DMZ' }).map());
  assert.equal(sv.ruleProblems(), sv.ruleProblems());
});
