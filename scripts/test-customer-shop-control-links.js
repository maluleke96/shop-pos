/**
 * Customer Shop Control — link isolation & entitlement reflection (local, no deploy).
 * Verifies Customer A/B/C never share URLs and Chisa is never used as a default.
 */
'use strict';

const assert = require('assert');
const cp = require('../electron/services/platform-control-plane');

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function shop(id, url, flags) {
  return {
    id,
    shop_name: `Shop ${id}`,
    shop_url: url,
    subscription_status: 'ACTIVE',
    deployment_status: 'READY',
    is_active: true,
    entitlements: {
      flags: flags || {},
      modules: {},
      pages: {},
      admin_sections: {}
    }
  };
}

const access = { subscription_status: 'ACTIVE', access_state: 'ACTIVE' };

// Customer A: POS + Online
const a = shop('cust-a', 'https://customer-a.example.railway.app', { pos: true, online: true });
// Customer B: POS only
const b = shop('cust-b', 'https://customer-b.example.railway.app', { pos: true });
// Customer C: POS + Online + Signage
const c = shop('cust-c', 'https://customer-c.example.railway.app', { pos: true, online: true, signage: true });

const linksA = cp.buildCustomerAppLinks(a, a.entitlements, access, { ok: true });
const linksB = cp.buildCustomerAppLinks(b, b.entitlements, access, { ok: true });
const linksC = cp.buildCustomerAppLinks(c, c.entitlements, access, { ok: true });

const byId = (links, id) => links.find((l) => l.id === id);

log('A base URL is customer A only', cp.resolveCustomerBaseUrl(a) === 'https://customer-a.example.railway.app');
log('B base URL is customer B only', cp.resolveCustomerBaseUrl(b) === 'https://customer-b.example.railway.app');
log('C base URL is customer C only', cp.resolveCustomerBaseUrl(c) === 'https://customer-c.example.railway.app');

log('A POS available with A URL', byId(linksA, 'pos').status === 'available' && byId(linksA, 'pos').url.startsWith('https://customer-a.example.railway.app'));
log('A Online available', byId(linksA, 'online').status === 'available');
log('A Signage not included', byId(linksA, 'signage').status === 'not_included' && !byId(linksA, 'signage').url);

log('B POS available with B URL', byId(linksB, 'pos').status === 'available' && byId(linksB, 'pos').url.startsWith('https://customer-b.example.railway.app'));
log('B Online not included', byId(linksB, 'online').status === 'not_included' && !byId(linksB, 'online').url);
log('B Signage not included', byId(linksB, 'signage').status === 'not_included');

log('C POS + Online + Signage available',
  byId(linksC, 'pos').status === 'available'
  && byId(linksC, 'online').status === 'available'
  && byId(linksC, 'signage').status === 'available'
  && byId(linksC, 'signage').url.startsWith('https://customer-c.example.railway.app'));

// Isolation: no customer link contains another customer's host
const hosts = {
  a: 'customer-a.example.railway.app',
  b: 'customer-b.example.railway.app',
  c: 'customer-c.example.railway.app'
};
function noCross(links, selfHost, otherHosts) {
  return links.every((l) => {
    if (!l.url) return true;
    if (!l.url.includes(selfHost)) return false;
    return otherHosts.every((h) => !l.url.includes(h));
  });
}
log('A links never contain B/C hosts', noCross(linksA, hosts.a, [hosts.b, hosts.c]));
log('B links never contain A/C hosts', noCross(linksB, hosts.b, [hosts.a, hosts.c]));
log('C links never contain A/B hosts', noCross(linksC, hosts.c, [hosts.a, hosts.b]));

// Chisa protection
log('Chisa URL rejected as base', cp.resolveCustomerBaseUrl({ shop_url: 'https://chisafood.up.railway.app' }) === null);
log('peaceful-motivation rejected', cp.resolveCustomerBaseUrl({ shop_url: 'https://peaceful-motivation.up.railway.app' }) === null);
const chisaLinks = cp.buildCustomerAppLinks(
  shop('bad', 'https://chisafood.up.railway.app', { pos: true, online: true }),
  { flags: { pos: true, online: true }, modules: {}, pages: {}, admin_sections: {} },
  access,
  { ok: true }
);
log('Chisa shop produces no openable URLs', chisaLinks.every((l) => !l.url));

// Empty shop_url → provisioning / not fake URL
const bare = shop('bare', '', { pos: true });
const bareLinks = cp.buildCustomerAppLinks(bare, bare.entitlements, access, null);
log('No shop_url → no constructed URLs', bareLinks.every((l) => !l.url));
log('No shop_url POS shows provisioning or not_included path',
  ['provisioning', 'not_included', 'unavailable'].includes(byId(bareLinks, 'pos').status));

// Suspended
const sus = { ...a, subscription_status: 'SUSPENDED' };
const susLinks = cp.buildCustomerAppLinks(sus, sus.entitlements, { subscription_status: 'SUSPENDED', access_state: 'SUSPENDED' }, { ok: true });
log('Suspended POS shows suspended status', byId(susLinks, 'pos').status === 'suspended' && !!byId(susLinks, 'pos').url);

const failed = results.filter((r) => !r.ok);
console.log('\n---');
console.log(`Customer Shop Control link tests: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}

// sanity assert package export count
assert.ok(cp.CUSTOMER_APP_LINK_DEFS.length >= 14, 'expected full app link catalog');
console.log('Chisa Food: not touched');
