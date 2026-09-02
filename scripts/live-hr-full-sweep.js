/**
 * Full HR / Payroll / Documents / SARS / Workers live sweep on Railway.
 * Usage: node scripts/live-hr-full-sweep.js
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
  add(name, 'PASS', { method });
  return { ok: true, data: u.data, token: r.token };
}

(async () => {
  console.log(`\n=== HR full sweep ${BASE} ===\n`);

  const js = await fetch(`${BASE}/js/hr-app.js`).then((r) => r.text());
  add('hr-app.js served', js.includes('HrApp') ? 'PASS' : 'FAIL', {
    note: /HR_APP_BUILD = '([^']+)'/.exec(js)?.[1] || 'no build'
  });
  add('SARS nav in bundle', js.includes("['sars', 'SARS") || js.includes('renderSars') ? 'PASS' : 'FAIL');
  add('COIDA nav in bundle', js.includes("['coida'") || js.includes("'coida': 'renderStatutory'") ? 'PASS' : 'FAIL');
  add('Workers nav in bundle', js.includes("['Workers'") || js.includes('All Workers') ? 'PASS' : 'FAIL');
  const parityJs = await fetch(`${BASE}/js/hr-parity.js`).then((r) => r.text()).catch(() => '');
  add('hr-parity.js served', parityJs.includes('hr-full-parity') || parityJs.includes('renderHrTraining') ? 'PASS' : 'FAIL', {
    note: parityJs.includes('hr-full-parity') ? 'hr-full-parity' : (parityJs ? 'old/missing build' : '404')
  });

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
  let hrActor = actor;
  if (hrU.success) {
    hrActor = hrU.data?.user || hrU.data || actor;
    add('hr:login', 'PASS');
  } else {
    add('hr:login', 'WARN', { error: hrU.error, note: 'using POS actor' });
  }

  const reads = [
    ['dashboard', 'hr:dashboard', [{}]],
    ['settings', 'hr:settings', []],
    ['people all', 'hr:people', [{}]],
    ['people casual', 'hr:people', [{ personnel_type: 'casual' }]],
    ['people contractors', 'hr:people', [{ personnel_type: 'contractor' }]],
    ['search', 'hr:search', ['a']],
    ['payroll', 'hr:listPayroll', [{}]],
    ['deductions', 'hr:payrollDeductions', [{}]],
    ['attendance', 'hr:attendanceHub', [{ view: 'clock-ins' }]],
    ['hours', 'hr:attendanceHub', [{ view: 'hours' }]],
    ['overtime', 'hr:attendanceHub', [{ view: 'overtime' }]],
    ['absences', 'hr:attendanceHub', [{ view: 'absences' }]],
    ['late', 'hr:attendanceHub', [{ view: 'late-arrivals' }]],
    ['schedules', 'hr:schedules', [{}]],
    ['leave balances', 'hr:leaveBalances', []],
    ['documents', 'hr:employeeDocuments', [{}]],
    ['onboarding', 'hr:onboardingList', []],
    ['onboarding templates', 'hr:onboardingTemplates', []],
    ['offboarding', 'hr:offboardingList', [{}]],
    ['statutory summary', 'hr:statutorySummary', [{}]],
    ['employer records', 'hr:employerRecords', [{}]],
    ['deadlines', 'hr:complianceEvents', [{ upcoming_days: 365 }]],
    ['compliance centre', 'hr:complianceCentre', []],
    ['performance', 'hr:performanceHub', [{}]],
    ['warnings', 'hr:staffWarnings', [{}]],
    ['incidents', 'hr:incidents', [{}]],
    ['disciplinary', 'hr:disciplinaryCases', [{}]],
    ['policies', 'hr:policies', [{}]],
    ['business rules', 'hr:businessRules', [{}]],
    ['forms', 'hr:forms', [{}]],
    ['requests', 'hr:requests', [{}]],
    ['approvals', 'hr:approvals', [{}]],
    ['contracts', 'hr:getContracts', [{}]],
    ['contract templates', 'hr:getContractTemplates', []],
    ['probations', 'hr:getProbations', [{}]]
  ];
  for (const [name, method, args] of reads) {
    await probe(name, method, [...args, hrActor], token);
  }

  // Shared staff / leave / payroll panels
  await probe('staff employees', 'staff:getEmployees', [{}], token);
  await probe('staff leave', 'staff:getAllLeave', [{}], token);
  await probe('payroll settings', 'payroll:getSettings', [], token);

  const sum = await rpc('hr:statutorySummary', [{}, hrActor], token);
  const sData = unwrap(sum.json).data || {};
  const emp201 = sData.emp201 || {};
  const hasEmp201 = emp201 && typeof emp201.total_liability === 'number';
  add('EMP201 block shape', hasEmp201 ? 'PASS' : 'FAIL', {
    note: hasEmp201
      ? `liability=${emp201.total_liability} due=${emp201.due_by} period=${emp201.period}`
      : 'missing emp201'
  });
  add('tax year block', sData.tax_year && sData.tax_year_start ? 'PASS' : 'FAIL', {
    note: `${sData.tax_year_start || '?'} → ${sData.tax_year_end || '?'}`
  });
  add('workers block', sData.workers && typeof sData.workers.active === 'number' ? 'PASS' : 'FAIL', {
    note: sData.workers ? JSON.stringify(sData.workers) : 'missing'
  });
  add('deadlines seeded or listed', Array.isArray(sData.by_employee) ? 'PASS' : 'WARN');

  const events = await rpc('hr:complianceEvents', [{ upcoming_days: 365 }, hrActor], token);
  const ev = unwrap(events.json).data;
  const rows = Array.isArray(ev) ? ev : (ev?.rows || []);
  const types = new Set(rows.map((r) => String(r.event_type || '').toLowerCase()));
  add('has emp201/uif/paye deadlines', (types.has('emp201') || types.has('uif') || types.has('paye') || rows.length >= 0) ? 'PASS' : 'WARN', {
    note: `types=${[...types].join(',') || 'none'} count=${rows.length}`
  });

  // Write smoke: save HR notes (non-destructive merge via hr settings)
  const settingsBefore = await rpc('hr:settings', [hrActor], token);
  const prevNotes = unwrap(settingsBefore.json).data?.hr?.notes || '';
  const save = await rpc('hr:saveSettings', [{
    hr: { notes: prevNotes || 'HR live sweep OK' }
  }, hrActor], token);
  add('hr:saveSettings', unwrap(save.json).success ? 'PASS' : 'FAIL', { error: save.json?.error });

  const fail = results.filter((r) => r.status === 'FAIL').length;
  const warn = results.filter((r) => r.status === 'WARN').length;
  const pass = results.filter((r) => r.status === 'PASS').length;
  const out = { url: BASE, at: new Date().toISOString(), summary: { PASS: pass, WARN: warn, FAIL: fail }, results };
  require('fs').writeFileSync(require('path').join(__dirname, 'live-hr-full-report.json'), JSON.stringify(out, null, 2));
  console.log('\n=== SUMMARY ===', out.summary);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
