'use strict';
/* unusedObjects, diffModels (Compare) and csvCell */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { office } = require('./helpers/exp');

const sv = loadSonicView();

/* ---------- unusedObjects ---------- */

function unused(e) {
  sv.load(e.map());
  const u = sv.unusedObjects();
  return { addrs: u.addrs.map(a => a.name).sort(), svcs: u.svcs.map(s => s.name).sort() };
}

test('unusedObjects: anything referenced by a rule, NAT, route or VPN is used', () => {
  const e = office()
    .host('PC', '192.168.10.50')
    .host('Web Server', '192.168.10.20')
    .host('WAN Web IP', '203.0.113.3', { zone: 'WAN' })
    .network('Branch', '10.20.0.0', '255.255.0.0', { zone: 'VPN' })
    .host('Branch GW', '10.20.0.1')
    .host('Old Host', '192.168.10.99')
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', svc: 'Web' })
    .nat({ origDst: 'WAN Web IP', origSvc: 'SSH', transDst: 'Web Server', inIf: 'X1' })
    .route({ name: 'to branch', dst: 'Branch', gw: 'Branch GW', iface: 'X0' })
    .vpn({ name: 'Branch', gw: '198.51.100.2', remote: 'Branch' });
  eq(unused(e), { addrs: ['Old Host'], svcs: ['DNS', 'Ping', 'RDP'] });
});

test('unusedObjects: members of a used group are used, through nested groups', () => {
  const e = office()
    .host('Deep', '192.168.10.5').group('Mid', ['Deep']).group('Top', ['Mid'])
    .host('Orphan Member', '192.168.10.6').group('Orphan Group', ['Orphan Member'])
    .serviceGroup('Admin', ['SSH', 'RDP']).serviceGroup('All Admin', ['Admin'])
    .rule({ from: 'LAN', to: 'DMZ', dst: 'Top', svc: 'All Admin' });
  eq(unused(e), { addrs: ['Orphan Group', 'Orphan Member'], svcs: ['DNS', 'HTTP', 'HTTPS', 'Ping', 'Web'] });
});

test('unusedObjects: group membership alone does not make an object used', () => {
  const e = office().rule({ from: 'LAN', to: 'WAN', svc: 'DNS' });
  /* HTTP/HTTPS are only members of the unused "Web" group */
  eq(unused(e).svcs, ['HTTP', 'HTTPS', 'Ping', 'RDP', 'SSH', 'Web']);
});

test('unusedObjects: a name shared by an address and a service does not make either used', {
  todo: 'unusedObjects matches names against every value in the file. An unused address object called "Web" counts as used because the service object "Web" exists (svcObjId_N=Web). Zone or interface names cause the same.',
}, () => {
  const e = office().host('Web', '192.168.10.80').rule({ from: 'LAN', to: 'WAN', svc: 'DNS' });
  assert.ok(unused(e).addrs.includes('Web'));
});

/* ---------- diffModels ---------- */

function diff(kvA, kvB) {
  const A = sv.buildModel(kvA), B = sv.buildModel(kvB);
  return sv.diffModels(sv.snapshot(A), sv.snapshot(B));
}
const short = d => d.map(x => [x.area, x.change, x.item]);

function fw() {
  return office()
    .host('PC', '192.168.10.50')
    .host('DMZ Web', '172.16.5.20', { zone: 'DMZ' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'SSH', action: 'Deny' })
    .nat({ origDst: '203.0.113.3', transDst: 'DMZ Web', origSvc: 'HTTPS', inIf: 'X1' });
}

test('diffModels: identical files have no differences', () => {
  eq(diff(fw().map(), fw().map()), []);
});

test('diffModels: objects added, removed and changed', () => {
  const B = fw().host('New Host', '192.168.10.60').map();
  B.set('addrObjIp1_0', '192.168.10.51');               /* PC */
  const d = diff(fw().host('Old Host', '192.168.10.99').map(), B);
  eq(d.filter(x => x.area === 'Address objects'), [
    { area: 'Address objects', change: 'Changed', item: 'PC', before: 'Host: 192.168.10.50 · zone LAN', after: 'Host: 192.168.10.51 · zone LAN' },
    { area: 'Address objects', change: 'Added', item: 'New Host', before: '', after: 'Host: 192.168.10.60 · zone LAN' },
    { area: 'Address objects', change: 'Removed', item: 'Old Host', before: 'Host: 192.168.10.99 · zone LAN', after: '' },
  ]);
});

test('diffModels: interface and service changes', () => {
  const B = fw().map();
  B.set('iface_lan_ip_2', '172.16.6.1');                /* X2 */
  B.set('svcObjPort1_2', '2222'); B.set('svcObjPort2_2', '2222'); /* SSH */
  eq(short(diff(fw().map(), B)), [['Interfaces', 'Changed', 'X2'], ['Service objects', 'Changed', 'SSH']]);
});

test('diffModels: rules are matched by what they do, not their number', () => {
  const A = fw().rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' }).map();
  const B = office()
    .host('PC', '192.168.10.50').host('DMZ Web', '172.16.5.20', { zone: 'DMZ' })
    .rule({ from: 'LAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS', enabled: false }) /* turned off */
    .rule({ from: 'WAN', to: 'DMZ', dst: 'DMZ Web', svc: 'HTTPS' })                 /* was #3, now #2 */
    .rule({ from: 'LAN', to: 'DMZ', src: 'PC', svc: 'RDP' })                         /* new */
    .nat({ origDst: '203.0.113.3', transDst: 'DMZ Web', origSvc: 'HTTPS', inIf: 'X1' })
    .map();
  const d = diff(A, B).filter(x => x.area === 'Firewall rules');
  eq(d.map(x => [x.change, x.before, x.after]), [
    ['Changed', '#1 · on', '#1 · off'],
    ['Added', '', '#3 · on'],
    ['Removed', '#2 · on', ''],
  ]);
  assert.match(d[2].item, /^Deny LAN → DMZ · Any → DMZ Web · SSH$/);
});

test('diffModels: identical rules are paired one to one', () => {
  const r = { from: 'LAN', to: 'DMZ', svc: 'RDP' };
  const d = diff(office().rule(r).rule(r).map(), office().rule(r).map());
  eq(short(d), [['Firewall rules', 'Removed', 'Allow LAN → DMZ · Any → Any · RDP']]);
});

test('diffModels: a rule that moved to another position is reported', {
  todo: 'Rules are matched by content only, so moving a rule above or below another (which changes what the firewall does) shows no difference.',
}, () => {
  const a = { from: 'LAN', to: 'DMZ', svc: 'RDP' }, b = { from: 'LAN', to: 'DMZ', action: 'Deny' };
  assert.notEqual(diff(office().rule(a).rule(b).map(), office().rule(b).rule(a).map()).length, 0);
});

test('diffModels: a changed NAT translation shows as removed + added', () => {
  const B = fw().map();
  B.set('natPolicyTransDst_0', 'PC');
  eq(short(diff(fw().map(), B)).map(x => x.slice(0, 2)), [['NAT policies', 'Added'], ['NAT policies', 'Removed']]);
});

test('diffModels: other settings compare by key; secret values never appear', () => {
  const A = fw().set('firewallName', 'old-fw').set('adminPasswordHash', 'aaaa1111').map();
  const B = fw().set('firewallName', 'new-fw').set('adminPasswordHash', 'bbbb2222').set('sharedSecretRadius', 'cccc3333').map();
  const d = diff(A, B);
  eq(d.filter(x => x.area === 'Other settings'), [
    { area: 'Other settings', change: 'Changed', item: 'firewallName', before: 'old-fw', after: 'new-fw' },
    { area: 'Other settings', change: 'Added', item: 'sharedSecretRadius', before: '', after: '•••• hidden' },
  ]);
  const text = JSON.stringify(d);
  for (const secret of ['aaaa1111', 'bbbb2222', 'cccc3333']) assert.ok(!text.includes(secret), secret);
});

/* ---------- csvCell ---------- */

test('csvCell: plain values pass through', () => {
  assert.equal(sv.csvCell('X0'), 'X0');
  assert.equal(sv.csvCell(42), '42');
  assert.equal(sv.csvCell(null), '');
  assert.equal(sv.csvCell(undefined), '');
  assert.equal(sv.csvCell('192.168.10.1'), '192.168.10.1');
});

test('csvCell: commas, quotes and line breaks are quoted', () => {
  assert.equal(sv.csvCell('a,b'), '"a,b"');
  assert.equal(sv.csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(sv.csvCell('line1\nline2'), '"line1\nline2"');
});

test('csvCell: formula starters get a leading apostrophe', () => {
  for (const v of ['=1+1', '+1', '@SUM(A1)', '-cmd', '- note', '\tx']) assert.equal(sv.csvCell(v), "'" + v, JSON.stringify(v));
  assert.equal(sv.csvCell('\r=1'), `"'\r=1"`);
  assert.equal(sv.csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
});

test('csvCell: negative numbers stay numbers, but "-<digit>" formulas are escaped', () => {
  for (const v of ['-5', '-5.5', '-0', '-']) assert.equal(sv.csvCell(v), v, v);
  for (const v of ['-1+1', "-2+3+cmd|' /C calc'!A0", '-1 do not delete']) assert.equal(sv.csvCell(v), "'" + v, v);
});
