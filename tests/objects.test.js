'use strict';
/* address and service resolution: addrRanges, addrCovers, svcLeaves, svcCovers, ... */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { exp, office } = require('./helpers/exp');

const sv = loadSonicView();
const n = ip => sv.ip2n(ip);
const r = (a, b = a) => [n(a), n(b)];
const use = e => sv.useModel(sv.buildModel(e.map()));

test('ip2n / n2ip / maskBits / isPrivate', () => {
  assert.equal(n('192.168.10.1'), 0xC0A80A01);
  assert.equal(n('255.255.255.255'), 0xFFFFFFFF);
  assert.equal(sv.n2ip(0xCB007102), '203.0.113.2');
  for (const bad of ['', '1.2.3', '1.2.3.256', 'a.b.c.d', null, undefined]) assert.equal(n(bad), null, String(bad));
  assert.equal(sv.maskBits('255.255.255.248'), 29);
  assert.equal(sv.maskBits('0.0.0.0'), 0);
  assert.equal(sv.maskBits('nope'), null);
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1']) assert.ok(sv.isPrivate(n(ip)), ip);
  for (const ip of ['192.0.2.1', '198.51.100.1', '203.0.113.1', '172.32.0.1', '100.128.0.1']) assert.ok(!sv.isPrivate(n(ip)), ip);
});

/* ---------- addrRanges ---------- */

function addrModel() {
  return use(exp()
    .host('Web', '192.168.10.20')
    .range('Printers', '192.168.10.100', '192.168.10.110')
    .network('LAN Net', '192.168.10.77', '255.255.255.0') /* host bits set on purpose */
    .network('One', '192.168.10.5', '255.255.255.255')
    .host('No IP', '')
    .fqdn('Updates', 'updates.example.com')
    .mac('Camera', '0050c2000001')
    .group('Servers', ['Web', 'Printers'])
    .group('Everything', ['Servers', 'LAN Net', 'Updates'])
    .group('Empty', []));
}

test('addrRanges: host, range and network', () => {
  addrModel();
  eq(sv.addrRanges('Web'), [r('192.168.10.20')]);
  eq(sv.addrRanges('Printers'), [r('192.168.10.100', '192.168.10.110')]);
  eq(sv.addrRanges('LAN Net'), [r('192.168.10.0', '192.168.10.255')], 'network is aligned to its mask');
  eq(sv.addrRanges('One'), [r('192.168.10.5')]);
});

test('addrRanges: nested groups flatten in member order; FQDN/MAC add nothing', () => {
  addrModel();
  eq(sv.addrRanges('Servers'), [r('192.168.10.20'), r('192.168.10.100', '192.168.10.110')]);
  eq(sv.addrRanges('Everything'), [r('192.168.10.20'), r('192.168.10.100', '192.168.10.110'), r('192.168.10.0', '192.168.10.255')]);
  eq(sv.addrRanges('Updates'), []);
  eq(sv.addrRanges('Camera'), []);
  eq(sv.addrRanges('Empty'), []);
});

test('addrRanges: names that are not objects', () => {
  addrModel();
  eq(sv.addrRanges('198.51.100.7'), [r('198.51.100.7')], 'a bare IP stands for itself');
  eq(sv.addrRanges('Missing'), []);
  eq(sv.addrRanges(''), []);
  eq(sv.addrRanges('No IP'), []);
});

test('addrRanges: a group cycle terminates and still collects every host', () => {
  use(exp().host('h1', '10.0.0.1').host('h2', '10.0.0.2').group('A', ['B', 'h1']).group('B', ['h2']).member('B', 'A'));
  const got = sv.addrRanges('A').map(x => sv.n2ip(x[0])).sort();
  eq(got, ['10.0.0.1', '10.0.0.2']);
});

test('addrRanges: members of a group cycle resolve the same whichever is asked first', {
  todo: 'addrRanges caches a partial result for groups visited mid-cycle (B is cached without A\'s hosts). SonicOS does not allow cycles, so impact is low.',
}, () => {
  use(exp().host('h1', '10.0.0.1').host('h2', '10.0.0.2').group('A', ['B', 'h1']).group('B', ['h2']).member('B', 'A'));
  sv.addrRanges('A');
  eq(sv.addrRanges('B').map(x => sv.n2ip(x[0])).sort(), ['10.0.0.1', '10.0.0.2']);
});

test('addrHosts: only hosts and small ranges count as taken IPs', () => {
  use(exp().host('h', '10.0.0.1').range('small', '10.0.1.0', '10.0.1.9').range('huge', '10.1.0.0', '10.2.0.0').network('net', '10.3.0.0', '255.255.255.0').group('g', ['h', 'small', 'huge', 'net']));
  eq(sv.addrHosts('g'), [r('10.0.0.1'), r('10.0.1.0', '10.0.1.9')]);
});

test('mergeRanges: sorts, merges overlapping and touching ranges', () => {
  eq(sv.mergeRanges([[10, 20], [1, 5], [6, 8], [15, 30], [40, 40]]), [[1, 8], [10, 30], [40, 40]]);
  eq(sv.mergeRanges([]), []);
});

/* ---------- addrCovers ---------- */

function coverModel() {
  return use(exp()
    .network('LAN Net', '192.168.10.0', '255.255.255.0')
    .range('Low Half', '192.168.10.0', '192.168.10.127')
    .range('High Half', '192.168.10.128', '192.168.10.255')
    .group('Both Halves', ['Low Half', 'High Half'])
    .host('Web', '192.168.10.20')
    .host('Outside', '192.168.11.20')
    .range('Straddle', '192.168.10.250', '192.168.11.5')
    .fqdn('Updates', 'updates.example.com')
    .group('Web+FQDN', ['Web', 'Updates'])
    .group('Empty', []));
}

test('addrCovers: Any (empty) covers everything; nothing specific covers Any', () => {
  coverModel();
  assert.equal(sv.addrCovers('', 'Web'), true);
  assert.equal(sv.addrCovers('', ''), true);
  assert.equal(sv.addrCovers('LAN Net', ''), false);
});

test('addrCovers: same name always covers, even when it has no IPs', () => {
  coverModel();
  assert.equal(sv.addrCovers('Updates', 'Updates'), true);
});

test('addrCovers: network contains hosts and ranges inside it, not outside or straddling', () => {
  coverModel();
  assert.equal(sv.addrCovers('LAN Net', 'Web'), true);
  assert.equal(sv.addrCovers('LAN Net', 'Low Half'), true);
  assert.equal(sv.addrCovers('LAN Net', 'Outside'), false);
  assert.equal(sv.addrCovers('LAN Net', 'Straddle'), false);
  assert.equal(sv.addrCovers('Web', 'LAN Net'), false);
});

test('addrCovers: touching ranges in a group are merged before checking', () => {
  coverModel();
  assert.equal(sv.addrCovers('Both Halves', 'LAN Net'), true);
  assert.equal(sv.addrCovers('Low Half', 'LAN Net'), false);
});

test('addrCovers: inner objects with unknown IPs (FQDN, unknown name, empty group) are never covered', () => {
  coverModel();
  assert.equal(sv.addrCovers('LAN Net', 'Web+FQDN'), false);
  assert.equal(sv.addrCovers('LAN Net', 'Missing'), false);
  assert.equal(sv.addrCovers('LAN Net', 'Empty'), false);
});

test('addrCovers: a bare IP name works as inner or outer', () => {
  coverModel();
  assert.equal(sv.addrCovers('LAN Net', '192.168.10.9'), true);
  assert.equal(sv.addrCovers('192.168.10.20', 'Web'), true);
});

/* ---------- services ---------- */

function svcModel() {
  return use(office()
    .service('High Ports', 'TCP', 1024, 65535)
    .service('Low TCP', 'TCP', 1, 100)
    .service('Mid TCP', 'TCP', 101, 200)
    .service('TCP 1-200', 'TCP', 1, 200)
    .service('Web Alt', 'TCP', 80, 8080)
    .service('Echo Reply', 'ICMP', 0)
    .service('GRE', 'GRE')
    .service('GRE 2', 'GRE', 5, 5)
    .serviceGroup('Split TCP', ['Low TCP', 'Mid TCP'])
    .serviceGroup('Admin', ['SSH', 'RDP'])
    .serviceGroup('Nested', ['Web', 'Admin'])
    .serviceGroup('Loop A', ['Loop B', 'HTTP'])
    .serviceGroup('Loop B', ['Loop A', 'DNS'])
    .serviceGroup('Nothing', []));
}

test('svcLeaves: flattens nested groups; unknown names give nothing; cycles terminate', () => {
  svcModel();
  eq(sv.svcLeaves('HTTP').map(s => s.name), ['HTTP']);
  eq(sv.svcLeaves('Nested').map(s => s.name), ['HTTP', 'HTTPS', 'SSH', 'RDP']);
  eq(sv.svcLeaves('Loop A').map(s => s.name).sort(), ['DNS', 'HTTP']);
  eq(sv.svcLeaves('Missing'), []);
  eq(sv.svcLeaves('Nothing'), []);
});

test('svcValue: readable protocol and port text', () => {
  svcModel();
  assert.equal(sv.svcValue('Web'), 'TCP 80, TCP 443');
  assert.equal(sv.svcValue('High Ports'), 'TCP 1024–65535');
  assert.equal(sv.svcValue('Ping'), 'ICMP type 8');
  assert.equal(sv.svcValue('GRE'), 'GRE');
});

test('svcCovers: Any covers everything; nothing specific covers Any; same name covers', () => {
  svcModel();
  assert.equal(sv.svcCovers('', 'HTTP'), true);
  assert.equal(sv.svcCovers('HTTP', ''), false);
  assert.equal(sv.svcCovers('Missing', 'Missing'), true);
});

test('svcCovers: TCP/UDP need the same protocol and the whole port range inside', () => {
  svcModel();
  assert.equal(sv.svcCovers('Web Alt', 'HTTP'), true);
  assert.equal(sv.svcCovers('Web Alt', 'HTTPS'), true);
  assert.equal(sv.svcCovers('HTTP', 'Web Alt'), false);
  assert.equal(sv.svcCovers('High Ports', 'RDP'), true);
  assert.equal(sv.svcCovers('Low TCP', 'TCP 1-200'), false, 'partial overlap is not cover');
  assert.equal(sv.svcCovers('HTTP', 'DNS'), false);
});

test('svcCovers: ICMP needs the same type; other protocols match on protocol only', () => {
  svcModel();
  assert.equal(sv.svcCovers('Ping', 'Ping'), true);
  assert.equal(sv.svcCovers('Ping', 'Echo Reply'), false);
  assert.equal(sv.svcCovers('GRE', 'GRE 2'), true);
});

test('svcCovers: groups — every inner leaf must sit inside one outer leaf', () => {
  svcModel();
  assert.equal(sv.svcCovers('Nested', 'Web'), true);
  assert.equal(sv.svcCovers('Nested', 'Admin'), true);
  assert.equal(sv.svcCovers('Web', 'Nested'), false);
  assert.equal(sv.svcCovers('Web Alt', 'Web'), true);
  assert.equal(sv.svcCovers('Nested', 'Nothing'), false, 'an empty inner group is never covered');
  assert.equal(sv.svcCovers('Missing', 'HTTP'), false);
});

test('svcCovers: a port range split across two members of a group is covered', {
  todo: 'svcCovers needs one outer leaf to hold the whole inner range; it does not merge TCP 1-100 + TCP 101-200 like addrCovers merges IP ranges.',
}, () => {
  svcModel();
  assert.equal(sv.svcCovers('Split TCP', 'TCP 1-200'), true);
});

test('svcOverlap: any shared protocol/port counts; Any overlaps everything', () => {
  svcModel();
  assert.equal(sv.svcOverlap('', 'HTTP'), true);
  assert.equal(sv.svcOverlap('HTTPS', ''), true);
  assert.equal(sv.svcOverlap('Web', 'Web Alt'), true);
  assert.equal(sv.svcOverlap('Low TCP', 'Mid TCP'), false);
  assert.equal(sv.svcOverlap('HTTP', 'DNS'), false);
  assert.equal(sv.svcOverlap('Ping', 'Echo Reply'), true, 'non-TCP/UDP compares protocol only');
});

test('overlaps: any pair of ranges intersecting', () => {
  assert.equal(sv.overlaps([[1, 5]], [[5, 9]]), true);
  assert.equal(sv.overlaps([[1, 5]], [[6, 9]]), false);
  assert.equal(sv.overlaps([], [[1, 2]]), false);
});
