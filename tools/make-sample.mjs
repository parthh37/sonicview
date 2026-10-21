// Builds the made-up settings file behind "Try with sample data" and writes it into sonicview.html.
//
//   node tools/make-sample.mjs         update the sample inside sonicview.html
//   node tools/make-sample.mjs --raw   print the settings as key=value lines instead
//
// Everything here is fake. Internet-side IPs come from the RFC 5737 documentation ranges
// (203.0.113.0/24, 198.51.100.0/24), inside IPs from RFC 1918. Key names match what buildModel()
// in sonicview.html reads. The rules are written to trip every check in ruleProblems() once.
import { readFile, writeFile } from 'node:fs/promises';

const HTML = new URL('../sonicview.html', import.meta.url);
const USER = 14, BUILTIN = 793, BUILTIN_GROUP = 797; // object properties: 14 = made by hand

/* ---------- system ---------- */
const settings = {
  shortProdName: 'NSA 3500', buildNum: '5.8.1.15-71o', serialNumber: 'SAMPLE000001', firewallName: 'Sample-HQ',
  dnsServer1: '198.51.100.53', dnsServer2: '198.51.100.54', dnsServer3: '0.0.0.0',
  ntp_useNtp: 'on', wlb_Enable: 'on', gavEnableScanning: 'on', isIDPEnabled: 'on',
  snmp_Enable: 'off', isAppCntrlEnabled: 'off', sslSpyEnabled: 'off', botnetBlock: 'off', geoEnforcement: 'off',
  SSLVPNServerEnabled: 'off', L2TPServerEnabled: 'off',
};

/* ---------- zones ---------- */
const zone = (name, type, sec = []) => ({
  zoneObjId: name, zoneObjProperties: 1, zoneObjZoneType: type,
  zoneObjGavProfile: +sec.includes('gav'), zoneObjMyIDPProfile: +sec.includes('ips'),
  zoneObjASProfile: +sec.includes('as'), zoneObjACProfile: 0,
});
const zones = [
  zone('LAN', 1, ['gav', 'ips', 'as']),
  zone('WAN', 0, ['ips']),
  zone('DMZ', 2, ['gav', 'ips', 'as']),
  zone('VPN', 5),
];

/* ---------- interfaces ---------- */
const iface = (name, ifnum, o) => ({
  iface_name: name, iface_ifnum: ifnum, interface_Zone: '', iface_comment: '',
  iface_static_ip: '0.0.0.0', iface_static_mask: '0.0.0.0', iface_static_gateway: '0.0.0.0',
  iface_lan_ip: '0.0.0.0', iface_lan_mask: '0.0.0.0', iface_dhcp_ip: '0.0.0.0', iface_dhcp_mask: '0.0.0.0',
  iface_vlan_tag: 0, iface_vlan_parent: -1, eth_mac: '02000000' + (0xa0 + ifnum).toString(16).padStart(4, '0'), eth_mtu: 1500,
  iface_https_mgmt: 0, iface_http_mgmt: 0, iface_ssh_mgmt: 0, iface_ping_mgmt: 0, iface_snmp_mgmt: 0,
  ...o,
});
const ifaces = [
  iface('X0', 0, { interface_Zone: 'LAN', iface_lan_ip: '192.168.10.1', iface_lan_mask: '255.255.255.0', iface_comment: 'Office LAN',
    iface_https_mgmt: 1, iface_ssh_mgmt: 1, iface_ping_mgmt: 1 }),
  iface('X1', 1, { interface_Zone: 'WAN', iface_static_ip: '203.0.113.2', iface_static_mask: '255.255.255.248',
    iface_static_gateway: '203.0.113.1', iface_comment: 'Primary ISP', iface_ping_mgmt: 1 }),
  iface('X2', 2, { interface_Zone: 'DMZ', iface_lan_ip: '172.16.50.1', iface_lan_mask: '255.255.255.0', iface_comment: 'DMZ servers',
    iface_ping_mgmt: 1 }),
  iface('X3', 3, { interface_Zone: 'WAN', iface_static_ip: '198.51.100.18', iface_static_mask: '255.255.255.252',
    iface_static_gateway: '198.51.100.17', iface_comment: 'Backup ISP' }),
  iface('X4', 4, {}),
  iface('X0:V20', 8, { interface_Zone: 'LAN', iface_lan_ip: '192.168.20.1', iface_lan_mask: '255.255.255.0',
    iface_comment: 'Voice VLAN (phones)', iface_vlan_tag: 20, iface_vlan_parent: 0, eth_mac: '0200000000a0', iface_ping_mgmt: 1 }),
];

/* ---------- address objects ---------- */
const addr = (name, type, zone, ip1, ip2, props) => ({ addrObjId: name, addrObjType: type, addrObjZone: zone, addrObjIp1: ip1, addrObjIp2: ip2, addrObjProperties: props });
const host = (name, zone, ip, props = USER) => addr(name, 1, zone, ip, '0.0.0.0', props);
const range = (name, zone, from, to) => addr(name, 2, zone, from, to, USER);
const network = (name, zone, net, mask, props = USER) => addr(name, 4, zone, net, mask, props);
const group = (name, members, props = USER) => ({ ...addr(name, 8, '', '0.0.0.0', '0.0.0.0', props), members });
const addrs = [
  /* built in: the firewall makes these for its own ports */
  host('X0 IP', 'LAN', '192.168.10.1', BUILTIN),
  network('X0 Subnet', 'LAN', '192.168.10.0', '255.255.255.0', BUILTIN),
  network('X0:V20 Subnet', 'LAN', '192.168.20.0', '255.255.255.0', BUILTIN),
  host('X1 IP', 'WAN', '203.0.113.2', BUILTIN),
  host('X1 Default Gateway', 'WAN', '203.0.113.1', BUILTIN),
  network('X2 Subnet', 'DMZ', '172.16.50.0', '255.255.255.0', BUILTIN),
  host('X3 IP', 'WAN', '198.51.100.18', BUILTIN),
  host('X3 Default Gateway', 'WAN', '198.51.100.17', BUILTIN),
  group('LAN Subnets', ['X0 Subnet', 'X0:V20 Subnet'], BUILTIN_GROUP),
  /* made by hand */
  host('Web Server', 'DMZ', '172.16.50.10'),
  host('Mail Server', 'DMZ', '172.16.50.20'),
  host('Old FTP Server', 'DMZ', '172.16.50.30'),
  group('DMZ Servers', ['Web Server', 'Mail Server']),
  host('File Server', 'LAN', '192.168.10.10'),
  host('Terminal Server', 'LAN', '192.168.10.15'),
  host('NAS', 'LAN', '192.168.10.20'),
  range('Admin PCs', 'LAN', '192.168.10.50', '192.168.10.59'),
  host('Core Switch', 'LAN', '192.168.10.254'),
  network('Lab Network', 'LAN', '10.50.0.0', '255.255.0.0'),
  host('Web Server Public', 'WAN', '203.0.113.3'),
  host('Mail Server Public', 'WAN', '203.0.113.4'),
  host('RDP Public', 'WAN', '203.0.113.5'),
  network('Partner Network', 'WAN', '198.51.100.128', '255.255.255.224'),
  range('Spam Senders', 'WAN', '198.51.100.230', '198.51.100.239'),
  network('Branch Office LAN', 'VPN', '10.20.0.0', '255.255.255.0'),
  /* unused: nothing refers to these */
  host('Test Laptop', 'LAN', '192.168.10.250'),
  host('Front Desk Printer', 'LAN', '192.168.10.230'),
  group('Printers', ['Front Desk Printer']),
];
const fqdns = [{ addrObjFqdnId: 'Cloud Backup', addrObjFqdnZone: 'WAN', addrObjFqdn: 'backup.example.net', addrObjFqdnProperties: USER }];

/* ---------- service objects ---------- */
const TCP = 6, UDP = 17, ICMP = 1;
const svc = (name, proto, p1, p2 = p1, props = BUILTIN) => ({ svcObjId: name, svcObjType: 1, svcObjIpType: proto, svcObjPort1: p1, svcObjPort2: p2, svcObjProperties: props });
const svcGroup = (name, members) => ({ svcObjId: name, svcObjType: 2, svcObjIpType: 0, svcObjPort1: 0, svcObjPort2: 0, svcObjProperties: USER, members });
const svcs = [
  svc('HTTP', TCP, 80), svc('HTTPS', TCP, 443), svc('SMTP', TCP, 25), svc('IMAPS', TCP, 993), svc('SSH', TCP, 22),
  svc('FTP', TCP, 21), svc('SMB', TCP, 445), svc('Terminal Services TCP', TCP, 3389),
  svc('DNS (Name Service) UDP', UDP, 53), svc('Ping', ICMP, 8),
  svc('Mail Submission', TCP, 587, 587, USER),
  svc('SFTP 2222', TCP, 2222, 2222, USER),
  svc('Custom App 9000', TCP, 9000, 9000, USER), // unused
  svcGroup('Web Services', ['HTTP', 'HTTPS']),
  svcGroup('Mail Services', ['SMTP', 'Mail Submission', 'IMAPS']),
];

const scheds = [{ schedObjId: 'Work Hours', schedObjProperties: USER }];

/* ---------- NAT ---------- */
const X1 = 1, X3 = 3;
const nat = o => ({
  natPolicyOrigSrc: '', natPolicyOrigDst: '', natPolicyOrigSvc: '', natPolicyTransSrc: '', natPolicyTransDst: '', natPolicyTransSvc: '',
  natPolicySrcIface: -1, natPolicyDstIface: -1, natPolicyEnabled: 1, natPolicyComment: '', natPolicyProperties: 0, natPolicyReflexive: 0, ...o,
});
const forward = (pub, port, inside, comment, o = {}) => nat({ natPolicyOrigDst: pub, natPolicyOrigSvc: port, natPolicyTransDst: inside, natPolicySrcIface: X1, natPolicyComment: comment, ...o });
const nats = [
  forward('Web Server Public', 'Web Services', 'Web Server', 'Public website'),
  forward('Mail Server Public', 'Mail Services', 'Mail Server', 'Mail server'),
  forward('Web Server Public', 'SFTP 2222', 'Web Server', 'Partner SFTP uploads', { natPolicyOrigSrc: 'Partner Network', natPolicyTransSvc: 'SSH' }),
  forward('RDP Public', 'Terminal Services TCP', 'Terminal Server', 'Remote desktop for staff'), // risky: RDP open to anyone
  forward('X1 IP', 'SMB', 'NAS', 'NAS access for home users'), // risky, and no rule allows it
  forward('Web Server Public', 'FTP', 'Old FTP Server', 'Old FTP site', { natPolicyEnabled: 0 }),
  nat({ natPolicyTransSrc: 'X1 IP', natPolicyDstIface: X1, natPolicyComment: 'Auto-added outbound NAT Policy for X1', natPolicyProperties: 1023 }),
  nat({ natPolicyTransSrc: 'X3 IP', natPolicyDstIface: X3, natPolicyComment: 'Auto-added outbound NAT Policy for X3', natPolicyProperties: 1023 }),
];

/* ---------- firewall rules, in the order the firewall checks them ---------- */
const ACTION = { Deny: 0, Discard: 1, Allow: 2 };
const rule = (action, from, to, src, dst, svc, comment, o = {}) => ({
  policyAction: ACTION[action], policySrcZone: from, policyDstZone: to, policySrcNet: src, policyDstNet: dst, policyDstSvc: svc,
  policyEnabled: 1, policyComment: comment, policyTime: '', policyProps: 0, ...o, // policyProps 0 = made by hand
});
const auto = (action, from, to) => rule(action, from, to, '', '', '', '', { policyProps: 1 });
const rules = [
  rule('Allow', 'LAN', 'WAN', 'LAN Subnets', '', '', 'Office internet access'),
  rule('Allow', 'LAN', 'WAN', 'File Server', 'Cloud Backup', 'HTTPS', 'Nightly cloud backup'), // never used: rule above covers it
  rule('Allow', 'LAN', 'DMZ', 'Admin PCs', 'DMZ Servers', 'SSH', 'Admin SSH to DMZ servers'),
  rule('Allow', 'LAN', 'DMZ', 'Admin PCs', 'DMZ Servers', 'SSH', 'SSH for admins'), // duplicate of the rule above
  rule('Allow', 'LAN', 'DMZ', '', 'Legacy App Server', 'HTTPS', 'Old intranet app'), // missing object
  rule('Allow', 'WAN', 'DMZ', '', 'Web Server Public', 'Web Services', 'Public website'),
  rule('Allow', 'WAN', 'DMZ', 'Partner Network', 'Web Server Public', 'SFTP 2222', 'Partner SFTP uploads'),
  rule('Allow', 'WAN', 'DMZ', '', 'Mail Server Public', '', 'Mail server (opened for troubleshooting)'), // wide open from internet
  rule('Deny', 'WAN', 'DMZ', 'Spam Senders', 'Mail Server Public', 'SMTP', 'Block known spam senders'), // block never works
  rule('Allow', 'WAN', 'LAN', '', 'RDP Public', 'Terminal Services TCP', 'Remote desktop for staff'), // risky port
  rule('Allow', 'WAN', 'LAN', 'Partner Network', 'RDP Public', 'Terminal Services TCP', 'Vendor remote support (paused)',
    { policyEnabled: 0, policyTime: 'Work Hours' }), // turned off
  rule('Deny', 'DMZ', 'LAN', '', 'LAN Subnets', '', 'Keep the DMZ out of the office LAN'),
  rule('Allow', 'DMZ', 'LAN', 'Web Server', 'File Server', 'SMB', 'Website reads shared files'), // allow never works
  rule('Allow', 'VPN', 'LAN', '', '', '', 'Branch office full access'), // allows everything
  rule('Allow', 'LAN', 'VPN', 'LAN Subnets', 'Branch Office LAN', '', 'Office to branch office'),
  /* the firewall's own defaults */
  auto('Allow', 'LAN', 'WAN'), auto('Allow', 'LAN', 'LAN'), auto('Allow', 'LAN', 'DMZ'), auto('Allow', 'DMZ', 'WAN'),
  auto('Deny', 'WAN', 'LAN'), auto('Deny', 'WAN', 'DMZ'), auto('Deny', 'DMZ', 'LAN'),
];

/* ---------- routes, DHCP, VPN, users ---------- */
const routes = [
  { pbrObjId: 'Lab network via core switch', pbrObjSrc: '', pbrObjDst: 'Lab Network', pbrObjSvc: '', pbrObjGw: 'Core Switch', pbrObjIfaceName: 'X0', pbrObjMetric: 20, pbrObjPriority: '' },
  { pbrObjId: 'Cloud backup over backup ISP', pbrObjSrc: 'File Server', pbrObjDst: 'Cloud Backup', pbrObjSvc: 'HTTPS', pbrObjGw: 'X3 Default Gateway', pbrObjIfaceName: 'X3', pbrObjMetric: 10, pbrObjPriority: '' },
];
const dhcp = (start, end, router, dns, lease, domain) => ({
  prefs_dhdynstart: start, prefs_dhdynend: end, prefs_dhdynrouter: router, prefs_dhdynsubnetmask: '255.255.255.0', prefs_dhdynscopeactive: 'on',
  prefs_dhdyndns0: dns[0] || '0.0.0.0', prefs_dhdyndns1: dns[1] || '0.0.0.0', prefs_dhdyndns2: dns[2] || '0.0.0.0',
  prefs_dhdynlease: lease, prefs_dhdyndomainname: domain,
});
const scopes = [
  dhcp('192.168.10.100', '192.168.10.199', '192.168.10.1', ['192.168.10.10', '198.51.100.53'], 1440, 'office.example'),
  dhcp('192.168.20.100', '192.168.20.150', '192.168.20.1', ['192.168.10.10'], 480, 'office.example'),
];
const vpns = [
  { ipsecName: 'WAN GroupVPN', ipsecGwAddr: '0.0.0.0', ipsecSecGwAddr: '0.0.0.0', ipsecLocalNetwork: '', ipsecRemoteNetwork: '', ipsecSaDisabled: 'on', ipsecSharedSecret: 'sample-not-a-real-secret' },
  { ipsecName: 'Branch Office', ipsecGwAddr: '198.51.100.77', ipsecSecGwAddr: '0.0.0.0', ipsecLocalNetwork: 'LAN Subnets', ipsecRemoteNetwork: 'Branch Office LAN', ipsecSaDisabled: 'off', ipsecSharedSecret: 'sample-not-a-real-secret' },
];
const users = [
  { userObjId: 'alex.admin', userObjComment: 'IT admin', groups: ['Administrators'] },
  { userObjId: 'jordan.remote', userObjComment: 'Works from home', groups: ['SSLVPN Services'] },
  { userObjId: 'sam.vendor', userObjComment: 'Vendor support account', groups: ['SSLVPN Services'] },
];
const ugroups = [
  { userGroupObjId: 'Administrators', userGroupObjComment: '' },
  { userGroupObjId: 'SSLVPN Services', userGroupObjComment: 'Remote access users' },
];

/* ---------- write key=value pairs ---------- */
const kv = [];
const set = (k, v) => kv.push([k, String(v)]);
/* one numbered key per field: addrObjId_0, addrObjType_0, ... */
const table = (rows, skip = []) => rows.forEach((row, i) => { for (const [k, v] of Object.entries(row)) if (!skip.includes(k)) set(`${k}_${i}`, v); });
/* group membership pairs: member name in atom key, group name in grp key */
const links = (atomKey, grpKey, pairs) => pairs.forEach(([atom, grp], i) => { set(`${atomKey}_${i}`, atom); set(`${grpKey}_${i}`, grp); });

for (const [k, v] of Object.entries(settings)) set(k, v);
table(zones);
table(ifaces);
table(addrs, ['members']);
table(fqdns);
links('addro_atomToGrp', 'addro_grpToGrp', addrs.flatMap(g => (g.members || []).map(m => [m, g.addrObjId])));
table(svcs, ['members']);
links('so_atomToGrp', 'so_grpToGrp', svcs.flatMap(g => (g.members || []).map(m => [m, g.svcObjId])));
table(scheds);
table(nats);
table(rules);
table(routes);
table(scopes);
table(vpns);
table(users, ['groups']);
table(ugroups);
links('uo_atomToGrp', 'uo_grpToGrp', users.flatMap(u => u.groups.map(g => [u.userObjId, g])));

if (process.argv.includes('--raw')) {
  console.log(kv.map(([k, v]) => `${k}=${v}`).join('\n'));
} else {
  /* same shape as a real export: base64 of key=value&key=value with URL-encoded values */
  const b64 = Buffer.from(kv.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')).toString('base64');
  const lines = b64.match(/.{1,100}/g).join('\n');
  const html = await readFile(HTML, 'utf8');
  const re = /(<script type="text\/plain" id="sampleExp">)[^<]*(<\/script>)/;
  if (!re.test(html)) throw new Error('No <script type="text/plain" id="sampleExp"> block found in sonicview.html');
  await writeFile(HTML, html.replace(re, (_, open, close) => `${open}\n${lines}\n${close}`));
  console.log(`Wrote ${kv.length} settings (${b64.length.toLocaleString()} base64 characters) into sonicview.html`);
}
