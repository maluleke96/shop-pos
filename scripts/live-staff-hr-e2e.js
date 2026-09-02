/**
 * Live Staff Portal + HR end-to-end sweep (Railway).
 * Usage: node scripts/live-staff-hr-e2e.js
 */
const BASE = (process.env.SMOKE_URL || 'https://peaceful-motivation-production-7dd2.up.railway.app').replace(/\/$/, '');
const USER = process.env.SMOKE_USER || 'chisa96';
const PASS = process.env.SMOKE_PASS || '123456';

const results = [];
function add(name, status, detail = {}) {
  results.push({ name, status, ...detail });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '!';
  console.log(`[${icon}] ${name} | ${status}${detail.error ? ' — ' + detail.error : ''}${detail.note ? ' — ' + detail.note : ''}`);
}

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const res = await fetch(`${BASE}/rpc`, { method: 'POST', headers, body: JSON.stringify({ method, args }) });
  const json = await res.json().catch(() => ({ success: false, error: 'invalid json' }));
  const nextTok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { ok: res.ok, status: res.status, json, token: nextTok };
}

function unwrap(json) {
  if (!json) return { success: false, error: 'no response' };
  if (json.success === false) return { success: false, error: json.error || 'failed' };
  return { success: true, data: json.data !== undefined ? json.data : json };
}

async function probe(name, method, args, token) {
  const r = await rpc(method, args, token);
  const u = unwrap(r.json);
  if (!u.success) {
    add(name, 'FAIL', { method, error: u.error });
    return { ok: false, data: null, token: r.token };
  }
  add(name, 'PASS', { method, note: detailNote(name, u.data) });
  return { ok: true, data: u.data, token: r.token };
}

function detailNote(name, data) {
  if (Array.isArray(data)) return `${data.length} rows`;
  if (data && typeof data === 'object' && data.request_number) return data.request_number;
  return '';
}

(async () => {
  console.log(`\n=== Staff + HR E2E ${BASE} ===\n`);

  // Static bundles
  const [hrApp, hrParity, indexHtml, staffJs] = await Promise.all([
    fetch(`${BASE}/js/hr-app.js`).then((r) => r.text()),
    fetch(`${BASE}/js/hr-parity.js`).then((r) => r.text()).catch(() => ''),
    fetch(`${BASE}/`).then((r) => r.text()),
    fetch(`${BASE}/js/pages/staff.js`).then((r) => r.text()).catch(() => '')
  ]);

  const hrBuild = /HR_APP_BUILD = '([^']+)'/.exec(hrApp)?.[1] || 'unknown';
  add('hr-app.js build', hrBuild.includes('hr-full-parity') ? 'PASS' : 'FAIL', { note: hrBuild });
  add('hr-parity.js served', hrParity.includes('hr-full-parity') || hrParity.includes('renderHrTraining') ? 'PASS' : 'FAIL');
  add('hr-parity nav sections', hrParity.includes('Training & Probation') && hrParity.includes('payroll-compliance') ? 'PASS' : 'FAIL');
  add('staff portal screen in index', indexHtml.includes('screen-staff-portal') ? 'PASS' : 'FAIL');
  add('staff.js salary claims UI', staffJs.includes('Salary Claims') || staffJs.includes('salaryClaims') ? 'PASS' : 'FAIL');
  add('staff.js selfie flow', staffJs.includes('pendingSelfie') || staffJs.includes('StaffSelfieCapture') ? 'PASS' : 'FAIL');

  let login = await rpc('auth:login', [USER, PASS]);
  if (!unwrap(login.json).success) {
    add('auth login', 'FAIL', { error: login.json?.error });
    process.exit(1);
  }
  let token = login.token || login.json.sessionToken;
  const actor = login.json.user || login.json.data?.user;
  add('auth login', 'PASS', { note: actor?.username });

  const hrLogin = await rpc('hr:login', [USER, PASS], token);
  const hrU = unwrap(hrLogin.json);
  const hrActor = hrU.success ? (hrU.data?.user || hrU.data || actor) : actor;
  add('hr:login', hrU.success ? 'PASS' : 'FAIL', { error: hrU.error });

  const reads = [
    ['HR approvals queue', 'hr:approvals', [{}]],
    ['Training records', 'hrTraining:getRecords', [{}]],
    ['Staff submissions', 'hrTraining:getSubmissions', [{}]],
    ['Training templates', 'hrTraining:getTemplates', [null]],
    ['Probations', 'hr:getProbations', [{}]],
    ['HR contracts', 'hr:getContracts', [{}]],
    ['Contract templates', 'hr:getContractTemplates', []],
    ['Job postings', 'jobs:getPostings', [{}]],
    ['Job candidates', 'jobs:getCandidates', [{}]],
    ['Recruitment settings', 'jobs:getSettings', []],
    ['Login selfies', 'staff:getSelfies', [{ from: '2020-01-01', to: '2099-12-31' }]],
    ['Login events', 'staff:getLoginEvents', [{ from: '2020-01-01', to: '2099-12-31' }]],
    ['Salary claims', 'salaryClaims:list', [{}]],
    ['Staff employees', 'staff:getEmployees', [{}]],
    ['Payroll settings', 'payroll:getSettings', []],
    ['Employee of month history', 'employeeOfMonth:getHistory', [{}]],
    ['Ops rules', 'ops:getRules', [{}]]
  ];
  for (const [name, method, args] of reads) {
    await probe(name, method, [...args, hrActor], token);
  }

  // Staff portal settings
  const settingsRes = await rpc('settings:get', [], token);
  const settings = unwrap(settingsRes.json).data || settingsRes.json || {};
  const ps = settings.staff_portal_settings || settings.data?.staff_portal_settings || {};
  add('staff portal settings object', typeof ps === 'object' ? 'PASS' : 'WARN', {
    note: `selfie=${ps.require_login_selfie ? 'on' : 'off'}`
  });

  // Employee list for portal login probe
  const empsRes = await rpc('staff:getEmployees', [{ status: 'Active' }, hrActor], token);
  const emps = unwrap(empsRes.json).data || [];
  const emp = emps[0];
  add('active employee for portal', emp?.employee_code ? 'PASS' : 'WARN', {
    note: emp ? `${emp.full_name} (${emp.employee_code})` : 'no active employees'
  });

  if (emp?.employee_code) {
    const badLogin = await rpc('staff:login', [emp.employee_code, '000000'], token);
    const badU = unwrap(badLogin.json);
    add('staff:login rejects bad PIN', !badU.success ? 'PASS' : 'FAIL', { error: badU.error || 'should fail' });
  }

  // HR approval round-trip (non-destructive submit + admin reject)
  const submit = await rpc('hr:submitForApproval', [{
    request_type: 'training_save',
    title: 'E2E test — training save (auto-reject)',
    details: 'Live e2e sweep — safe to reject',
    payload: { data: { employee_id: emp?.id || 0, status: 'draft', start_date: '2026-09-02' } }
  }, hrActor], token);
  const subRow = unwrap(submit.json).data;
  add('hr:submitForApproval', subRow?.id || subRow?.request_number ? 'PASS' : 'FAIL', {
    note: subRow?.request_number || subRow?.id
  });

  if (subRow?.id) {
    const reject = await rpc('hr:decideRequest', [subRow.id, 'rejected', 'E2E auto-reject', actor], token);
    add('hr:decideRequest reject', unwrap(reject.json).success ? 'PASS' : 'FAIL', { error: reject.json?.error });
  }

  // Selfie save shape (tiny 1x1 png) — only if we have employee id
  if (emp?.id) {
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const selfieRes = await rpc('staff:saveSelfie', [{
      employee_id: emp.id,
      photo_data: tinyPng,
      login_date: new Date().toLocaleDateString('en-CA')
    }, actor], token);
    const selfieOk = unwrap(selfieRes.json).success;
    add('staff:saveSelfie (admin)', selfieOk ? 'PASS' : 'FAIL', { error: selfieRes.json?.error });
  }

  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const pass = results.filter((r) => r.status === 'PASS').length;
  const out = { url: BASE, at: new Date().toISOString(), summary: { PASS: pass, WARN: warn, FAIL: fail }, results };
  require('fs').writeFileSync(require('path').join(__dirname, 'live-staff-hr-e2e-report.json'), JSON.stringify(out, null, 2));
  console.log('\n=== SUMMARY ===', out.summary);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
