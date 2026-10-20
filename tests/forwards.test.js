'use strict';
/* port forwards (derive) and how they are matched to allow rules */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSonicView, eq } = require('./helpers/harness');
const { office } = require('./helpers/exp');

const sv = loadSonicView();

/* one inbound forward: 203.0.113.3:443 on X1 -> 192.168.10.20 */
function base() {
  return office()
    .host('WAN Web IP', '203.0.113.3', { zone: 'WAN' })
    .range('WAN IPs', '203.0.113.2', '203.0.113.6', { zone: 'WAN' })
    .host('Web Server', '192.168.10.20')
    .host('Printer', '192.168.10.30')
    .host('Printer VIP', '192.168.10.31')
    .nat({ origDst: 'WAN Web IP', origSvc: 'HTTPS', transDst: 'Web Server', inIf: 'X1', comment: 'web' });
}
const forward = e => sv.load(e.map()).forwards[0];

test('a NAT policy that rewrites the destination becomes a port forward', () => {
  const f = forward(base());
  assert.equal(f.kind, 'Inbound');
  eq(f.pub, [[sv.ip2n('203.0.113.3'), sv.ip2n('203.0.113.3')]]);
  eq(f.inside, [[sv.ip2n('192.168.10.20'), sv.ip2n('192.168.10.20')]]);
  assert.equal(f.pubPorts, 'TCP 443');
  assert.equal(f.inPorts, 'same');
});

test('NAT policies that keep the destination are not port forwards', () => {
  const m = sv.load(office()
    .host('Web Server', '192.168.10.20')
    .nat({ transSrc: 'X1 IP', outIf: 'X1' })
    .nat({ origDst: 'Web Server', transDst: 'Web Server' })
    .map());
  eq(m.forwards, []);
});

test('port text: translated service, and Any when no service is set', () => {
  const m = sv.load(base()
    .service('Alt HTTPS', 'TCP', 8443)
    .nat({ origDst: 'WAN Web IP', origSvc: 'Alt HTTPS', transDst: 'Web Server', transSvc: 'HTTPS', inIf: 'X1' })
    .nat({ origDst: 'WAN Web IP', transDst: 'Web Server', inIf: 'X1' })
    .map());
  eq(m.forwards.map(f => [f.pubPorts, f.inPorts]), [['TCP 443', 'same'], ['TCP 8443', 'TCP 443'], ['Any', 'Any']]);
});

test('Inbound vs Internal: public original IP, or arriving on a WAN-zone interface', () => {
  const m = sv.load(base()
    .nat({ origDst: 'Printer VIP', transDst: 'Printer', inIf: 'X0' })                /* private, LAN port */
    .nat({ origDst: 'Printer VIP', transDst: 'Printer', inIf: 'X1' })                /* private, WAN port */
    .nat({ origDst: '198.51.100.40', transDst: 'Printer' })                          /* public, any port */
    .map());
  eq(m.forwards.map(f => f.kind), ['Inbound', 'Internal', 'Inbound', 'Inbound']);
});

/* ---------- allow-rule matching ---------- */

const allowCases = [
  ['rule to the public object and service', { dst: 'WAN Web IP', svc: 'HTTPS' }, true],
  ['rule to another object holding the public IP', { dst: 'WAN IPs' }, true],
  ['rule to the bare public IP', { dst: '203.0.113.3', svc: 'HTTPS' }, true],
  ['rule with a service group that includes the port', { dst: 'WAN Web IP', svc: 'Web' }, true],
  ['rule to the inside (translated) address', { dst: 'Web Server', svc: 'HTTPS' }, false],
  ['rule for another port', { dst: 'WAN Web IP', svc: 'SSH' }, false],
  ['deny rule', { dst: 'WAN Web IP', svc: 'HTTPS', action: 'Deny' }, false],
  ['disabled rule', { dst: 'WAN Web IP', svc: 'HTTPS', enabled: false }, false],
  ['auto-added rule', { dst: 'WAN Web IP', svc: 'HTTPS', auto: true }, false],
];
for (const [name, rule, matches] of allowCases) {
  test(`allow matching: ${name} ${matches ? 'counts' : 'does not count'}`, () => {
    const f = forward(base().rule({ from: 'WAN', to: 'LAN', ...rule }));
    assert.equal(f.allow.length, matches ? 1 : 0);
  });
}

test('allow matching: an inbound allow rule with Any destination lets the forward in', {
  todo: 'derive() needs r.dst to be set, so "WAN → LAN, Any → Any, HTTPS, Allow" is not seen as allowing the forward and a false "Port forward with no allow rule" is shown.',
}, () => {
  assert.equal(forward(base().rule({ from: 'WAN', to: 'LAN', svc: 'HTTPS' })).allow.length, 1);
});

test('allow matching: a rule between inside zones does not let internet traffic in', {
  todo: 'derive() ignores rule zones, so a LAN → LAN rule to the public IP counts as the allow rule for an inbound WAN forward.',
}, () => {
  assert.equal(forward(base().rule({ from: 'LAN', to: 'LAN', dst: 'WAN Web IP', svc: 'HTTPS' })).allow.length, 0);
});

/* ---------- the problem it feeds ---------- */

const noAllow = e => {
  sv.load(e.map());
  return sv.ruleProblems().filter(p => p.kind === 'Port forward with no allow rule').map(p => [p.sev, p.nat.n]);
};

test('Port forward with no allow rule: flagged for enabled inbound forwards only', () => {
  eq(noAllow(base()), [['Medium', 1]]);
  eq(noAllow(base().rule({ from: 'WAN', to: 'LAN', dst: 'WAN Web IP', svc: 'HTTPS' })), []);
  eq(noAllow(office().host('Web Server', '192.168.10.20').nat({ origDst: '203.0.113.3', transDst: 'Web Server', inIf: 'X1', enabled: false })), []);
  eq(noAllow(office().host('A', '192.168.10.31').host('B', '192.168.10.30').nat({ origDst: 'A', transDst: 'B', inIf: 'X0' })), [], 'internal forward');
});
