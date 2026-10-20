'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { exp, office } = require('./helpers/exp');

const sv = loadSonicView();
const ifaceOf = (m, name) => m.ifaces.find(f => f.name === name);

test('buildModel: system info, DNS servers without 0.0.0.0', () => {
  const m = sv.buildModel(office().map());
  eq(m.sys, { model: 'TZ 400', fw: 'SonicOS Enhanced 6.5.4.4', serial: '0017C5000000', name: 'test-fw', dns: ['192.0.2.53'] });
});

test('buildModel: empty export still gives a usable model', () => {
  const m = sv.buildModel(new Map([['shortProdName', 'TZ']]));
  for (const k of ['zones', 'ifaces', 'nat', 'rules', 'routes', 'dhcp', 'vpn', 'users']) assert.equal(m[k].length, 0, k);
  assert.equal(m.addrs.size, 0);
  assert.equal(m.sys.model, 'TZ');
});

test('buildModel: interface IP comes from static, then LAN, then DHCP field', () => {
  const m = sv.buildModel(exp()
    .iface({ name: 'X1', zone: 'WAN', ip: '203.0.113.2', mask: '255.255.255.248', as: 'static', gw: '203.0.113.1' })
    .iface({ name: 'X0', zone: 'LAN', ip: '192.168.10.1', as: 'lan' })
    .iface({ name: 'X3', zone: 'WAN', ip: '198.51.100.20', as: 'dhcp' })
    /* both static and LAN set: static wins */
    .iface({ name: 'X4', zone: 'LAN', ip: '10.0.4.1', as: 'static', fields: { iface_lan_ip: '10.9.9.1', iface_lan_mask: '255.255.0.0' } })
    .map());
  const pick = f => ({ ip: f.ip, mask: f.mask, mode: f.mode, gw: f.gw, cidr: f.cidr });
  eq(pick(ifaceOf(m, 'X1')), { ip: '203.0.113.2', mask: '255.255.255.248', mode: 'Static', gw: '203.0.113.1', cidr: 29 });
  eq(pick(ifaceOf(m, 'X0')), { ip: '192.168.10.1', mask: '255.255.255.0', mode: 'Static', gw: '', cidr: 24 });
  eq(pick(ifaceOf(m, 'X3')), { ip: '198.51.100.20', mask: '255.255.255.0', mode: 'DHCP', gw: '', cidr: 24 });
  eq(pick(ifaceOf(m, 'X4')), { ip: '10.0.4.1', mask: '255.255.255.0', mode: 'Static', gw: '', cidr: 24 });
});

test('buildModel: interface network, broadcast and size', () => {
  const f = ifaceOf(sv.buildModel(office().map()), 'X1');
  assert.equal(sv.n2ip(f.net), '203.0.113.0');
  assert.equal(sv.n2ip(f.bc), '203.0.113.7');
  assert.equal(f.size, 8);
});

test('buildModel: gateway is only kept when the static IP is the one in use', () => {
  /* a LAN port with a leftover static gateway must not claim it */
  const m = sv.buildModel(exp().iface({ name: 'X0', zone: 'LAN', ip: '192.168.10.1', as: 'lan', gw: '192.168.10.254' }).map());
  assert.equal(ifaceOf(m, 'X0').gw, '');
});

test('buildModel: interfaces with no IP are "Unassigned" only when they also have no zone', () => {
  const m = sv.buildModel(exp().iface({ name: 'X5' }).iface({ name: 'X6', zone: 'LAN' }).map());
  assert.equal(ifaceOf(m, 'X5').mode, 'Unassigned');
  assert.equal(ifaceOf(m, 'X6').mode, '');
  assert.equal(ifaceOf(m, 'X5').net, undefined);
});

test('buildModel: VLAN sub-interface finds its parent by interface number', () => {
  const m = sv.buildModel(office()
    .iface({ name: 'X0:V30', ifnum: 30, zone: 'LAN', ip: '192.168.30.1', vlan: 30, parent: '77' }) /* no such parent */
    .map());
  const v20 = ifaceOf(m, 'X0:V20');
  assert.equal(v20.vlan, 20);
  assert.equal(v20.parent, 'X0');
  assert.equal(ifaceOf(m, 'X0').parent, '', 'parent "-1" means none');
  assert.equal(ifaceOf(m, 'X0:V30').parent, '');
});

test('buildModel: ifName maps interface numbers to names', () => {
  const m = sv.buildModel(office().map());
  assert.equal(m.ifName('1'), 'X1');
  assert.equal(m.ifName('-1'), '');
  assert.equal(m.ifName(''), '');
  assert.equal(m.ifName('99'), 'if 99');
});

test('buildModel: management services per interface', () => {
  eq(ifaceOf(sv.buildModel(office().map()), 'X0').mgmt, ['https', 'ping']);
});

test('buildModel: address objects of every type, with group membership both ways', () => {
  const m = sv.buildModel(exp()
    .host('Web Server', '192.168.10.20')
    .range('Printers', '192.168.10.100', '192.168.10.110')
    .network('Guest Net', '192.168.50.0', '255.255.255.0')
    .fqdn('Updates', 'updates.example.com')
    .mac('Camera', '0050c2000001')
    .group('Servers', ['Web Server', 'Printers'])
    .map());
  eq([...m.addrs.keys()], ['Web Server', 'Printers', 'Guest Net', 'Servers', 'Camera', 'Updates']);
  eq([...m.addrs.values()].map(a => a.type), [1, 2, 4, 8, 'mac', 'fqdn']);
  eq(m.addrs.get('Servers').members, ['Web Server', 'Printers']);
  eq(m.addrs.get('Printers').memberOf, ['Servers']);
  assert.equal(m.addrs.get('Updates').fqdn, 'updates.example.com');
});

test('buildModel: a list stops at the first missing index', () => {
  const kv = exp().host('A', '192.168.10.1').host('B', '192.168.10.2').map();
  kv.delete('addrObjId_0');
  assert.equal(sv.buildModel(kv).addrs.size, 0);
});

test('buildModel: service objects and groups', () => {
  const m = sv.buildModel(office().map());
  eq(m.svcs.get('DNS'),
    { name: 'DNS', props: '14', type: 1, proto: 17, p1: 53, p2: 53, members: [], memberOf: [] });
  eq(m.svcs.get('Web').members, ['HTTP', 'HTTPS']);
  eq(m.svcs.get('HTTP').memberOf, ['Web']);
});

test('buildModel: rule actions, enabled flag and auto-added detection', () => {
  const m = sv.buildModel(exp()
    .rule({ from: 'LAN', to: 'WAN', action: 'Allow' })
    .rule({ from: 'LAN', to: 'WAN', action: 'Deny', enabled: false })
    .rule({ from: 'LAN', to: 'WAN', action: 'Discard', auto: true })
    .rule({ from: 'LAN', to: 'WAN', action: 7, comment: 'Auto-added for remote management' })
    .map());
  eq(m.rules.map(r => [r.n, r.action, r.enabled, r.auto]),
    [[1, 'Allow', true, false], [2, 'Deny', false, false], [3, 'Discard', true, true], [4, 'Action 7', true, true]]);
});

test('buildModel: NAT interfaces become names; built-in NAT policies are marked auto', () => {
  const m = sv.buildModel(office()
    .nat({ origDst: 'X1 IP', transDst: 'Web Server', inIf: 'X1', outIf: 'X0' })
    .nat({ transSrc: 'X1 IP', outIf: 'X1', comment: 'Management NAT Policy' })
    .nat({ transSrc: 'X1 IP', props: '1023' })
    .map());
  eq(m.nat.map(x => [x.n, x.inIf, x.outIf, x.auto]), [[1, 'X1', 'X0', false], [2, '', 'X1', true], [3, '', '', true]]);
});

test('buildModel: DHCP scope is tied to the interface whose subnet holds it', () => {
  const m = sv.buildModel(office()
    .dhcp({ start: '192.168.10.100', end: '192.168.10.199', router: '192.168.10.1', dns: ['192.168.10.1'] })
    .dhcp({ start: '10.99.0.10', end: '10.99.0.20', active: false })
    .map());
  eq(m.dhcp.map(d => [d.iface, d.active, d.dns]), [['X0', true, ['192.168.10.1']], ['', false, []]]);
});

test('buildModel: users and user groups', () => {
  const m = sv.buildModel(exp().userGroup('Sales').user('alice', ['Sales']).user('bob').map());
  eq(m.ugroups.find(g => g.name === 'Sales').members, ['alice']);
  eq(m.users.map(u => [u.name, u.memberOf]), [['alice', ['Sales']], ['bob', []]]);
});
