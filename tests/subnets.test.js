'use strict';
/* interface subnets (derive): IP status counts, free ranges, and the IP map view on huge subnets */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { exp } = require('./helpers/exp');

const sv = loadSonicView();
const ip = s => sv.ip2n(s);
const subnet = (m, key) => m.subnets.find(s => s.key === key);

/* the per-address walk derive() used to do: the reference the claims-only walk must match */
function walkEveryAddress(s) {
  const c = { iface: 0, used: 0, dhcp: 0, free: 0, res: 0 }, free = [];
  let fs = null;
  for (let n = s.net; n <= s.bc; n++) {
    const st = sv.ipStatus(n, s); c[st]++;
    if (st === 'free') { if (fs == null) fs = n; } else if (fs != null) { free.push([fs, n - 1]); fs = null; }
  }
  if (fs != null) free.push([fs, s.bc]);
  return { counts: c, free };
}
const sameAsWalk = m => { for (const s of m.subnets) eq({ counts: s.counts, free: s.free }, walkEveryAddress(s), s.key); };

/* a /24 with every kind of claim, a /16 around it, a WAN /29 with a gateway, a /31 and a /30 */
function mixed() {
  return exp().zone('LAN').zone('WAN', { type: 0 }).zone('DMZ', { type: 2 })
    .iface({ name: 'X0', zone: 'LAN', ip: '192.168.10.1' })
    .iface({ name: 'X1', zone: 'WAN', ip: '203.0.113.2', mask: '255.255.255.248', as: 'static', gw: '203.0.113.1' })
    .iface({ name: 'X2', zone: 'LAN', ip: '192.168.99.1', mask: '255.255.0.0' })
    .iface({ name: 'X3', zone: 'DMZ', ip: '198.51.100.10', mask: '255.255.255.254' })
    .iface({ name: 'X4', zone: 'DMZ', ip: '172.16.0.1', mask: '255.255.255.252' })
    /* objects on the network and broadcast address: still "res" */
    .host('Net', '192.168.10.0').host('Bcast', '192.168.10.255')
    .host('Next to FW', '192.168.10.2').host('Server', '192.168.10.50').host('Last', '192.168.10.254')
    .range('Block', '192.168.10.60', '192.168.10.69')
    .dhcp({ start: '192.168.10.100', end: '192.168.10.149' })
    /* a pool that is turned off claims its IPs but leaves them free, except one also used by an object */
    .dhcp({ start: '192.168.10.200', end: '192.168.10.219', active: false })
    .host('In off pool', '192.168.10.210')
    .host('WAN VIP', '203.0.113.3', { zone: 'WAN' })
    .nat({ origDst: 'WAN VIP', transDst: 'Server', inIf: 'X1' })
    .host('Peer', '198.51.100.11')
    .host('Elsewhere', '10.200.0.1');
}

test('derive: subnet counts and free ranges match a walk over every address', () => {
  const m = sv.load(mixed().map());
  eq(m.subnets.map(s => s.key), ['203.0.113.0/29', '172.16.0.0/30', '192.168.0.0/16', '192.168.10.0/24', '198.51.100.10/31']);
  sameAsWalk(m);
  /* the fixture really holds every status (hand-counted) */
  eq(subnet(m, '192.168.10.0/24').counts, { iface: 1, used: 14, dhcp: 50, free: 189, res: 2 });
  /* in the /16, the /24's network and broadcast objects are plain used IPs */
  eq(subnet(m, '192.168.0.0/16').counts, { iface: 2, used: 16, dhcp: 50, free: 65466, res: 2 });
  eq(subnet(m, '203.0.113.0/29').counts, { iface: 2, used: 1, dhcp: 0, free: 3, res: 2 });
  eq(subnet(m, '198.51.100.10/31').counts, { iface: 1, used: 1, dhcp: 0, free: 0, res: 0 });
  eq(subnet(m, '192.168.10.0/24').free.slice(0, 3), [[ip('192.168.10.3'), ip('192.168.10.49')], [ip('192.168.10.51'), ip('192.168.10.59')], [ip('192.168.10.70'), ip('192.168.10.99')]]);
});

test('derive: claims-only walk matches the full walk on random subnets', () => {
  /* mulberry32: fixed seed, so a failure always reproduces */
  let seed = 0x5eed;
  const rnd = k => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * k); };
  for (let i = 0; i < 300; i++) {
    const cidr = 22 + rnd(10), size = 2 ** (32 - cidr);
    const net = ip('10.0.0.0') + rnd(2 ** 24 / size) * size;
    /* offsets reach a little past both ends, so some claims fall just outside the subnet */
    const at = () => sv.n2ip(net - 3 + rnd(size + 6));
    const e = exp().zone('LAN').iface({ name: 'X0', zone: 'LAN', ip: sv.n2ip(net + rnd(size)), mask: sv.n2ip((0xffffffff << (32 - cidr)) >>> 0) });
    for (let k = rnd(12); k-- > 0;) {
      const pick = rnd(4), from = at(), to = sv.n2ip(ip(from) + rnd(30));
      if (pick === 0) e.host('h' + k, from);
      else if (pick === 1) e.range('r' + k, from, to);
      else if (pick === 2) e.dhcp({ start: from, end: to, active: rnd(2) === 0 });
      else e.host('v' + k, from).nat({ origDst: 'v' + k, transDst: 'h0' });
    }
    if (rnd(3) === 0) e.host('Net', sv.n2ip(net)).host('Bcast', sv.n2ip(net + size - 1));
    const m = sv.load(e.map());
    assert.equal(m.subnets.length, 1);
    sameAsWalk(m);
  }
});

/* a /8 LAN and a WAN with mask 0.0.0.0 (cidr 0: all 2^32 addresses) */
function huge() {
  return exp().zone('LAN').zone('WAN', { type: 0 })
    .iface({ name: 'X0', zone: 'LAN', ip: '10.1.2.1', mask: '255.0.0.0' })
    .iface({ name: 'X1', zone: 'WAN', ip: '203.0.113.2', mask: '0.0.0.0', as: 'static', gw: '203.0.113.1' })
    .host('Server', '10.200.0.9')
    .range('Pool', '10.0.0.1', '10.0.0.10')
    .dhcp({ start: '10.3.0.10', end: '10.3.0.59', mask: '255.0.0.0' });
}

test('derive: a /8 and a 0.0.0.0 mask load fast, with exact counts and free ranges', () => {
  const t = performance.now();
  const m = sv.load(huge().map());
  const ms = performance.now() - t;
  /* the old per-address walk took ~1 s for the /8 and minutes for the /0 */
  assert.ok(ms < 200, `buildModel + derive took ${ms.toFixed(0)} ms`);
  const a = subnet(m, '10.0.0.0/8'), z = subnet(m, '0.0.0.0/0');
  assert.equal(z.size, 2 ** 32);
  eq(a.counts, { iface: 1, used: 11, dhcp: 50, free: 2 ** 24 - 64, res: 2 });
  eq(z.counts, { iface: 3, used: 11, dhcp: 50, free: 2 ** 32 - 66, res: 2 });
  const r = (x, y) => [ip(x), ip(y)];
  eq(a.free, [r('10.0.0.11', '10.1.2.0'), r('10.1.2.2', '10.3.0.9'), r('10.3.0.60', '10.200.0.8'), r('10.200.0.10', '10.255.255.254')]);
  /* 10.0.0.0 is only reserved inside the /8; in the /0 it is a free address */
  eq(z.free, [r('0.0.0.1', '10.0.0.0'), r('10.0.0.11', '10.1.2.0'), r('10.1.2.2', '10.3.0.9'), r('10.3.0.60', '10.200.0.8'), r('10.200.0.10', '203.0.113.0'), r('203.0.113.3', '255.255.255.254')]);
});

/* a stand-in DOM element that keeps what the view writes: querySelector returns the same child for a selector */
function fakeEl() {
  const kids = new Map();
  return {
    innerHTML: '', style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: s => kids.get(s) ?? kids.set(s, fakeEl()).get(s), querySelectorAll: () => [],
    addEventListener() {}, appendChild: c => c, scrollIntoView() {}, closest: () => null,
  };
}
const count = (html, re) => (html.match(re) || []).length;
const bodyRows = html => count(html, /<tr>/g) - count(html, /<thead><tr>/g);
const squares = root => count(root.querySelector('#subpanel').querySelector('#blocks').innerHTML, /class="blk/g);

test('IP map: huge subnets list used IPs only and draw a square only for /24 blocks in use', () => {
  sv.load(huge().map());
  const root = fakeEl();
  const t = performance.now();
  sv.VIEWS.ipmap(root);
  /* the WAN /0 table: 64 IPs in use (2 firewall, 11 objects, 50 DHCP, 1 LAN interface) and a note, not 2^32 rows */
  const pubs = root.querySelector('#pubs').innerHTML;
  assert.equal(bodyRows(pubs), 65);
  assert.match(pubs, /4,294,967,296 addresses, so only the IPs in use are listed/);
  /* the /8 opens first: 4 of its 65,536 blocks hold used IPs */
  assert.equal(squares(root), 4);
  assert.match(root.querySelector('#subpanel').innerHTML, /very big \(65,536 \/24 blocks\)/);
  assert.equal(root._select('0.0.0.0/0'), true);
  assert.equal(squares(root), 5);
  const ms = performance.now() - t;
  assert.ok(ms < 200, `IP map took ${ms.toFixed(0)} ms`);
});

test('IP map: normal subnets still list every WAN IP and every /24 block', () => {
  sv.load(exp().zone('LAN').zone('WAN', { type: 0 })
    .iface({ name: 'X0', zone: 'LAN', ip: '172.16.0.1', mask: '255.255.0.0' })
    .iface({ name: 'X1', zone: 'WAN', ip: '203.0.113.2', mask: '255.255.255.248', as: 'static', gw: '203.0.113.1' })
    .host('Server', '172.16.40.9').map());
  const root = fakeEl();
  sv.VIEWS.ipmap(root);
  const pubs = root.querySelector('#pubs').innerHTML;
  assert.equal(bodyRows(pubs), 6);
  assert.doesNotMatch(pubs, /only the IPs in use/);
  assert.equal(squares(root), 256);
  assert.match(root.querySelector('#subpanel').innerHTML, /This subnet is big\. Pick a \/24 block/);
  eq(sv.model().subnets.map(s => s.claimed.map(sv.n2ip)), [['203.0.113.1', '203.0.113.2'], ['172.16.0.1', '172.16.40.9']]);
});
