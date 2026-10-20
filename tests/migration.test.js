'use strict';
/* smoke tests for the Migration guide's old-vs-new comparison */
const test = require('node:test');
const { loadSonicView, eq } = require('./helpers/harness');
const { office } = require('./helpers/exp');

const sv = loadSonicView();

function fw() {
  return office()
    .zone('Cameras', { builtin: false })
    .host('Web Server', '192.168.10.20')
    .host('NAS', '192.168.10.40')
    .rule({ from: 'WAN', to: 'LAN', dst: 'Web Server', svc: 'HTTPS' })
    .nat({ origDst: '203.0.113.3', transDst: 'Web Server', origSvc: 'HTTPS', inIf: 'X1' });
}
function check(A, B) {
  const sameNames = new Map(A.ifaces.map(f => [f.name, f.name]));
  return sv.migrationCheck(A, B, sameNames).map(r => [r.area, r.status, r.item]);
}

test('migrationCheck: a copy of the same file has nothing missing or different', () => {
  const rows = check(sv.buildModel(fw().map()), sv.buildModel(fw().map()));
  eq(rows.filter(r => r[1] !== 'Found'), []);
  eq([...new Set(rows.map(r => r[0]))].sort(), ['Address objects', 'Firewall rules', 'Interfaces', 'NAT policies', 'Service objects', 'Settings', 'Zones']);
});

test('migrationCheck: missing, renamed and changed objects', () => {
  const B = fw().map();
  B.set('addrObjId_1', 'Storage');            /* NAS renamed, same IP */
  B.set('addrObjIp1_0', '192.168.10.21');     /* Web Server moved */
  B.delete('zoneObjId_4');                    /* Cameras zone gone */
  const rows = check(sv.buildModel(fw().map()), sv.buildModel(B));
  eq(rows.filter(r => r[1] !== 'Found'), [
    ['Zones', 'Missing', 'Cameras'],
    ['Address objects', 'Different', 'Web Server'],
    ['Address objects', 'Renamed', 'NAS'],
    ['NAT policies', 'Different', '#1 Any → 203.0.113.3 (HTTPS) becomes Original → Web Server (Original)'],
    ['Firewall rules', 'Different', '#1 Allow WAN → LAN · Any → Web Server · HTTPS'],
  ]);
});
