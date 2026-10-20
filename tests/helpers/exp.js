'use strict';
/*
 * Builds small, synthetic SonicWall settings exports for tests.
 *
 * Use documentation / private address space only:
 *   public  192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24  (RFC 5737)
 *   inside  10/8, 172.16/12, 192.168/16                     (RFC 1918)
 * Never paste values from a real .exp file into a test.
 *
 * An export is a flat key/value list. Lists use an index suffix: addrObjId_0,
 * addrObjType_0, addrObjId_1, ... Each row() call appends one entry to a list,
 * so every key in that entry gets the same index.
 */

const PROTO = { ICMP: 1, TCP: 6, UDP: 17, GRE: 47, ESP: 50 };
const ACTION = { Deny: 0, Discard: 1, Allow: 2 };
/* low 16 bits = 14 marks an object as made by hand (see userMade() in the app) */
const USER_PROPS = '14';
const BUILTIN_PROPS = '12';

class Exp {
  constructor() {
    this.kv = new Map();
    this.counts = new Map();
    this.ifnums = new Map();
  }

  /** a single, non-indexed setting */
  set(key, value) {
    this.kv.set(key, String(value));
    return this;
  }

  /** append one entry to the indexed list `list`; returns the index used */
  row(list, fields) {
    const i = this.counts.get(list) ?? 0;
    this.counts.set(list, i + 1);
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) this.kv.set(`${k}_${i}`, String(v));
    return i;
  }

  system({ model = 'TZ 400', fw = 'SonicOS Enhanced 6.5.4.4', serial = '0017C5000000', name = 'test-fw', dns = [] } = {}) {
    this.set('shortProdName', model).set('buildNum', fw).set('serialNumber', serial).set('firewallName', name);
    dns.forEach((d, i) => this.set('dnsServer' + (i + 1), d));
    return this;
  }

  zone(name, { type = 1, builtin = true } = {}) {
    this.row('zone', { zoneObjId: name, zoneObjZoneType: type, zoneObjProperties: builtin ? BUILTIN_PROPS : USER_PROPS });
    return this;
  }

  /**
   * An interface. `as` picks which IP field holds the address, like real exports:
   * 'static' (iface_static_ip), 'lan' (iface_lan_ip) or 'dhcp' (iface_dhcp_ip).
   * The other IP fields are written as 0.0.0.0. `parent` is the parent's name.
   */
  iface({ name, ifnum, zone = '', ip = '', mask = '255.255.255.0', as = 'lan', gw = '', vlan = 0, parent = '', comment = '', mgmt = [], fields = {} }) {
    ifnum = String(ifnum ?? this.counts.get('iface') ?? 0);
    const ipf = { static: '0.0.0.0', lan: '0.0.0.0', dhcp: '0.0.0.0' };
    const maskf = { static: '0.0.0.0', lan: '0.0.0.0', dhcp: '0.0.0.0' };
    if (ip) { ipf[as] = ip; maskf[as] = mask; }
    const row = {
      iface_name: name, iface_ifnum: ifnum, interface_Zone: zone,
      iface_static_ip: ipf.static, iface_static_mask: maskf.static, iface_static_gateway: gw || '0.0.0.0',
      iface_lan_ip: ipf.lan, iface_lan_mask: maskf.lan,
      iface_dhcp_ip: ipf.dhcp, iface_dhcp_mask: maskf.dhcp,
      iface_comment: comment, iface_vlan_tag: vlan,
      iface_vlan_parent: parent ? this.ifnums.get(parent) ?? parent : '-1',
      ...Object.fromEntries(['https', 'http', 'ssh', 'ping', 'snmp'].map(x => [`iface_${x}_mgmt`, mgmt.includes(x) ? 1 : 0])),
      ...fields,
    };
    this.row('iface', row);
    this.ifnums.set(name, ifnum);
    return this;
  }

  /* ---- address objects ---- */
  addr(name, type, ip1, ip2, { zone = 'LAN', builtin = false } = {}) {
    this.row('addr', { addrObjId: name, addrObjType: type, addrObjZone: zone, addrObjIp1: ip1, addrObjIp2: ip2, addrObjProperties: builtin ? BUILTIN_PROPS : USER_PROPS });
    return this;
  }
  host(name, ip, opts) { return this.addr(name, 1, ip, '255.255.255.255', opts); }
  range(name, from, to, opts) { return this.addr(name, 2, from, to, opts); }
  network(name, net, mask, opts) { return this.addr(name, 4, net, mask, opts); }
  group(name, members, opts) {
    this.addr(name, 8, '0.0.0.0', '0.0.0.0', opts);
    for (const m of members) this.row('addro', { addro_atomToGrp: m, addro_grpToGrp: name });
    return this;
  }
  /** add one more member to an existing group (for cycles) */
  member(group, member) {
    this.row('addro', { addro_atomToGrp: member, addro_grpToGrp: group });
    return this;
  }
  fqdn(name, fqdn, { zone = 'WAN' } = {}) {
    this.row('fqdn', { addrObjFqdnId: name, addrObjFqdn: fqdn, addrObjFqdnZone: zone, addrObjFqdnProperties: USER_PROPS });
    return this;
  }
  mac(name, mac, { zone = 'LAN' } = {}) {
    this.row('mac', { addrObjMacId: name, addrObjMac: mac, addrObjMacZone: zone, addrObjMacProperties: USER_PROPS });
    return this;
  }

  /* ---- service objects ---- */
  service(name, proto, p1 = 0, p2 = p1, { builtin = false } = {}) {
    this.row('svc', { svcObjId: name, svcObjType: 1, svcObjIpType: PROTO[proto] ?? proto, svcObjPort1: p1, svcObjPort2: p2, svcObjProperties: builtin ? BUILTIN_PROPS : USER_PROPS });
    return this;
  }
  serviceGroup(name, members, { builtin = false } = {}) {
    this.row('svc', { svcObjId: name, svcObjType: 2, svcObjIpType: 0, svcObjPort1: 0, svcObjPort2: 0, svcObjProperties: builtin ? BUILTIN_PROPS : USER_PROPS });
    for (const m of members) this.row('so', { so_atomToGrp: m, so_grpToGrp: name });
    return this;
  }

  schedule(name) {
    this.row('sched', { schedObjId: name, schedObjProperties: USER_PROPS });
    return this;
  }

  /**
   * An access rule. Empty src/dst/svc mean Any. `auto` marks a rule the firewall
   * made itself (policyProps not 0); an auto Any/Any/Any rule is the zone pair's default.
   */
  rule({ from, to, action = 'Allow', src = '', dst = '', svc = '', enabled = true, sched = '', whom = '', auto = false, comment = '' }) {
    this.row('rule', {
      policyAction: ACTION[action] ?? action, policySrcZone: from, policyDstZone: to,
      policySrcNet: src, policyDstNet: dst, policyDstSvc: svc,
      policyEnabled: enabled ? 1 : 0, policyComment: comment, policyTime: sched, policyWhom: whom,
      policyProps: auto ? 1 : 0,
    });
    return this;
  }

  /** a NAT policy; inIf/outIf take interface names (or raw ifnums) */
  nat({ origSrc = '', origDst = '', origSvc = '', transSrc = '', transDst = '', transSvc = '', inIf = '', outIf = '', enabled = true, comment = '', props = '0', reflexive = false }) {
    const num = n => (n ? this.ifnums.get(n) ?? n : '-1');
    this.row('nat', {
      natPolicyOrigSrc: origSrc, natPolicyOrigDst: origDst, natPolicyOrigSvc: origSvc,
      natPolicyTransSrc: transSrc, natPolicyTransDst: transDst, natPolicyTransSvc: transSvc,
      natPolicySrcIface: num(inIf), natPolicyDstIface: num(outIf),
      natPolicyEnabled: enabled ? 1 : 0, natPolicyComment: comment, natPolicyProperties: props, natPolicyReflexive: reflexive ? 1 : 0,
    });
    return this;
  }

  route({ name, src = '', dst = '', svc = '', gw = '', iface = '', metric = 1 }) {
    this.row('route', { pbrObjId: name, pbrObjSrc: src, pbrObjDst: dst, pbrObjSvc: svc, pbrObjGw: gw, pbrObjIfaceName: iface, pbrObjMetric: metric });
    return this;
  }

  dhcp({ start, end, router = '', mask = '255.255.255.0', active = true, dns = [], lease = 1440, domain = '' }) {
    this.row('dhcp', {
      prefs_dhdynstart: start, prefs_dhdynend: end, prefs_dhdynrouter: router, prefs_dhdynsubnetmask: mask,
      prefs_dhdynscopeactive: active ? 'on' : 'off', prefs_dhdynlease: lease, prefs_dhdyndomainname: domain,
      ...Object.fromEntries(dns.map((d, i) => ['prefs_dhdyndns' + i, d])),
    });
    return this;
  }

  vpn({ name, gw = '', local = '', remote = '', enabled = true }) {
    this.row('vpn', { ipsecName: name, ipsecGwAddr: gw, ipsecSecGwAddr: '0.0.0.0', ipsecLocalNetwork: local, ipsecRemoteNetwork: remote, ipsecSaDisabled: enabled ? 'off' : 'on' });
    return this;
  }

  user(name, groups = []) {
    this.row('user', { userObjId: name, userObjComment: '' });
    for (const g of groups) this.row('uo', { uo_atomToGrp: name, uo_grpToGrp: g });
    return this;
  }
  userGroup(name) {
    this.row('ugroup', { userGroupObjId: name, userGroupObjComment: '' });
    return this;
  }

  /* ---- output ---- */
  map() { return new Map(this.kv); }
  /** the plain key=value&... body, values URL-encoded like a real export */
  text() { return [...this.kv].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); }
  /** the body as a .exp file holds it: base64, wrapped, with trailing && */
  base64({ wrap = 76 } = {}) {
    const b = Buffer.from(this.text(), 'latin1').toString('base64');
    return (wrap ? b.match(new RegExp(`.{1,${wrap}}`, 'g')).join('\n') : b) + '&&';
  }
}

const exp = () => new Exp();

/**
 * A small office: WAN on X1 (203.0.113.2/29), LAN on X0 (192.168.10.1/24),
 * a VLAN X0:V20 (192.168.20.1/24) and a DMZ on X2 (172.16.5.1/24).
 * Tests add the objects, rules and NAT they need on top.
 */
function office() {
  return exp()
    .system({ dns: ['192.0.2.53', '0.0.0.0'] })
    .zone('LAN').zone('WAN', { type: 0 }).zone('DMZ', { type: 2 }).zone('MULTICAST', { type: 6 })
    .iface({ name: 'X0', ifnum: 0, zone: 'LAN', ip: '192.168.10.1', as: 'lan', comment: 'Office LAN', mgmt: ['https', 'ping'] })
    .iface({ name: 'X1', ifnum: 1, zone: 'WAN', ip: '203.0.113.2', mask: '255.255.255.248', as: 'static', gw: '203.0.113.1' })
    .iface({ name: 'X2', ifnum: 2, zone: 'DMZ', ip: '172.16.5.1', as: 'lan' })
    .iface({ name: 'X0:V20', ifnum: 3, zone: 'LAN', ip: '192.168.20.1', as: 'lan', vlan: 20, parent: 'X0' })
    .service('HTTP', 'TCP', 80).service('HTTPS', 'TCP', 443).service('SSH', 'TCP', 22)
    .service('RDP', 'TCP', 3389).service('DNS', 'UDP', 53).service('Ping', 'ICMP', 8)
    .serviceGroup('Web', ['HTTP', 'HTTPS']);
}

module.exports = { exp, office, Exp, PROTO };
