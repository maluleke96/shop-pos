/**
 * Live Railway sweep: Referral Agent, HR/Payroll/Documents, Accounting, Bookkeeping.
 * Usage: node scripts/live-hr-acc-referral-sweep.js
 * Optional: SMOKE_URL, SMOKE_USER, SMOKE_PASS
 */
const BASE = (process.env.SMOKE_URL || 'https://chisafood.up.railway.app').replace(/\/$/, '');
const USER = process.env.SMOKE_USER || 'chisa96';
const PASS = process.env.SMOKE_PASS || '123456';

const results = [];
function add(module, name, status, detail = {}) {
  results.push({ module, name, status, ...detail });
  const icon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : status === 'WARN' ? '!' : '·';
  console.log(`[${icon}] ${module} | ${name} | ${status}${detail.error ? ' — ' + detail.error : ''}${detail.note ? ' — ' + detail.note : ''}`);
}

async function rpc(method, args = [], token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const t0 = Date.now();
  let res, json;
  try {
    res = await fetch(`${BASE}/rpc`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ method, args })
    });
    json = await res.json().catch(() => ({ success: false, error: 'invalid json' }));
  } catch (e) {
    return { ok: false, json: { success: false, error: e.message }, ms: Date.now() - t0, token };
  }
  const nextTok = res.headers.get('X-Session-Token') || json.sessionToken || token;
  return { ok: res.ok, status: res.status, json, ms: Date.now() - t0, token: nextTok };
}

async function httpGet(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: 'follow' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, len: text.length, text: text.slice(0, 400), hasError: /error-msg|ref-error|Could not load|Failed to/i.test(text) };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, ms: Date.now() - t0 };
  }
}

function unwrap(json) {
  if (!json) return { success: false, error: 'no response' };
  if (json.success === false) return { success: false, error: json.error || 'failed' };
  return { success: true, data: json.data !== undefined ? json.data : json };
}

async function probe(module, name, method, args, token, { allowEmpty = true, write = false } = {}) {
  const r = await rpc(method, args, token);
  const u = unwrap(r.json);
  if (!u.success) {
    add(module, name, 'FAIL', { method, error: u.error, http: r.status, ms: r.ms, write });
    return { ok: false, ...r, data: null };
  }
  const data = u.data;
  const empty = data == null || (Array.isArray(data) && data.length === 0)
    || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0);
  if (empty && !allowEmpty) {
    add(module, name, 'WARN', { method, note: 'empty data', ms: r.ms });
  } else {
    add(module, name, 'PASS', { method, ms: r.ms, note: empty ? 'empty OK' : undefined });
  }
  return { ok: true, data, token: r.token };
}

(async () => {
  console.log(`\n=== Live sweep ${BASE} ===\n`);

  // —— Static / entry pages ——
  for (const [mod, path] of [
    ['pages', '/'],
    ['pages', '/index.html'],
    ['referral', '/r/'],
    ['referral', '/r/TEST'],
    ['pages', '/order/'],
    ['pages', '/accounting-app.html'],
    ['pages', '/js/hr-app.js'],
    ['pages', '/js/accounting-app.js'],
    ['pages', '/js/marketing-agent-app.js'],
    ['pages', '/js/pages/bookkeeping.js'],
    ['pages', '/css/hr-command.css'],
    ['pages', '/css/accounting-command.css']
  ]) {
    const h = await httpGet(path);
    add(mod, `HTTP ${path}`, h.ok ? 'PASS' : 'FAIL', { status: h.status, ms: h.ms, error: h.error, note: h.hasError ? 'page contains error text' : undefined });
  }

  // —— Auth ——
  let login = await rpc('auth:login', [USER, PASS]);
  if (!unwrap(login.json).success) {
    add('auth', 'owner login', 'FAIL', { error: login.json?.error });
    console.log(JSON.stringify({ summary: summarize(results), results }, null, 2));
    process.exit(1);
  }
  let token = login.token || login.json.sessionToken;
  const actor = login.json.user || login.json.data?.user;
  add('auth', 'owner login', 'PASS', { note: `${actor?.username} (${actor?.role})` });

  // —— Referral / Marketing platform ——
  await probe('referral', 'mktp settings', 'mktp:settings', [], token);
  await probe('referral', 'mktp dashboard', 'mktp:dashboard', [{}, actor], token);
  const agentsR = await probe('referral', 'list agents', 'mktp:agents', [{}, actor], token);
  const agents = agentsR.data?.rows || agentsR.data || [];
  const active = (Array.isArray(agents) ? agents : []).find((a) => a.status === 'active' && (a.referral_code || a.agent_code))
    || (Array.isArray(agents) ? agents : []).find((a) => a.referral_code || a.agent_code);

  if (active) {
    const code = active.referral_code || active.agent_code;
    await probe('referral', 'publicAgent by code', 'mktp:publicAgent', [code], null);
    const page = await httpGet(`/r/${encodeURIComponent(code)}`);
    const bad = !page.ok || /ref-error|not recognised|No referral/i.test(page.text || '');
    add('referral', `landing /r/${code}`, bad ? 'FAIL' : 'PASS', { status: page.status, note: bad ? page.text?.slice(0, 120) : undefined });
    await probe('referral', 'recordClick', 'mktp:recordClick', [code, { source: 'live-sweep' }], null);
    await probe('referral', 'agent detail', 'mktp:getAgent', [active.id], token);
  } else {
    add('referral', 'active agent for landing', 'WARN', { note: 'no agent with referral_code — apply flow only' });
  }

  // Apply (write — unique phone)
  const applyTag = `sweep${Date.now().toString(36).slice(-6)}`;
  const apply = await rpc('mktp:applyAgent', [{
    full_name: `Live Sweep ${applyTag}`,
    phone: `07${String(Date.now()).slice(-8)}`,
    email: `${applyTag}@example.test`,
    city: 'Test City'
  }], token);
  const applyOk = unwrap(apply.json).success;
  add('referral', 'applyAgent (public)', applyOk ? 'PASS' : 'FAIL', { error: apply.json?.error, id: apply.json?.data?.id });

  await probe('referral', 'commissions list', 'mktp:commissions', [{}, actor], token);
  await probe('referral', 'leaderboard', 'mktp:leaderboard', [{}, actor], token);
  await probe('referral', 'promotions', 'mktp:promotions', [{}, actor], token);
  await probe('referral', 'campaigns', 'mktp:campaigns', [{}, actor], token);
  await probe('referral', 'agent portal dashboard (owner)', 'mktp:agentDashboard', [actor], token);

  // Marketing agent role login — try known agent users if any
  const usersProbe = await rpc('users:get', [{}], token);
  const users = usersProbe.json?.data || [];
  const mktUser = (Array.isArray(users) ? users : []).find((u) => u.role === 'marketing_agent' && u.is_active !== 0);
  if (mktUser) {
    add('referral', 'marketing_agent user exists', 'PASS', { note: mktUser.username });
    // Cannot know password — mark WARN for portal login
    add('referral', 'marketing_agent portal login', 'WARN', { note: `user ${mktUser.username} exists but password unknown — UI login not auto-tested` });
  } else {
    add('referral', 'marketing_agent user exists', 'WARN', { note: 'no marketing_agent role user — agent portal login untested' });
  }

  // mkt: (legacy agent tools) with owner
  await probe('referral', 'mkt adminSummary', 'mkt:adminSummary', [{}, actor], token);
  await probe('referral', 'mkt agents', 'mkt:agents', [{}], token);

  // —— HR ——
  const hrLogin = await rpc('hr:login', [USER, PASS], token);
  const hrU = unwrap(hrLogin.json);
  let hrActor = actor;
  if (hrU.success) {
    hrActor = hrU.data?.user || hrU.data || actor;
    add('hr', 'hr:login', 'PASS', { note: hrActor?.username || hrActor?.full_name });
  } else {
    // Many installs use POS session for HR
    add('hr', 'hr:login', 'WARN', { error: hrU.error, note: 'falling back to POS actor for hr:*' });
  }

  const hrReads = [
    ['dashboard', 'hr:dashboard', [{}]],
    ['settings', 'hr:settings', []],
    ['people', 'hr:people', [{}]],
    ['search', 'hr:search', ['']],
    ['payroll list', 'hr:listPayroll', [{}]],
    ['attendance hub', 'hr:attendanceHub', [{}]],
    ['schedules', 'hr:schedules', [{}]],
    ['leave balances', 'hr:leaveBalances', []],
    ['employee documents', 'hr:employeeDocuments', [{}]],
    ['offboarding', 'hr:offboardingList', [{}]],
    ['onboarding', 'hr:onboardingList', []],
    ['payroll deductions', 'hr:payrollDeductions', [{}]],
    ['statutory summary', 'hr:statutorySummary', [{}]],
    ['performance hub', 'hr:performanceHub', [{}]],
    ['staff warnings', 'hr:staffWarnings', [{}]],
    ['approvals', 'hr:approvals', [{}]],
    ['compliance centre', 'hr:complianceCentre', []],
    ['compliance events', 'hr:complianceEvents', [{}]],
    ['policies', 'hr:policies', [{}]],
    ['business rules', 'hr:businessRules', [{}]],
    ['incidents', 'hr:incidents', [{}]],
    ['disciplinary', 'hr:disciplinaryCases', [{}]],
    ['onboarding templates', 'hr:onboardingTemplates', []],
    ['forms', 'hr:forms', [{}]],
    ['requests', 'hr:requests', [{}]],
    ['employer records', 'hr:employerRecords', [{}]],
    ['contracts', 'hr:getContracts', [{}]],
    ['contract templates', 'hr:getContractTemplates', []],
    ['probations', 'hr:getProbations', [{}]],
    ['probation dashboard', 'hr:getProbationDashboard', [{}]],
    ['eval categories', 'hr:getEvalCategories', []]
  ];
  for (const [name, method, args] of hrReads) {
    await probe('hr', name, method, [...args, hrActor], token);
  }

  // payroll service
  const payrollReads = [
    ['payroll settings', 'payroll:getSettings', []],
    ['advances', 'payroll:getAdvances', [{}]],
    ['loans', 'payroll:getLoans', [{}]],
    ['runs', 'payroll:getRuns', [{}]],
    ['payslips', 'payroll:getPayslips', [{}]]
  ];
  for (const [name, method, args] of payrollReads) {
    const r = await rpc(method, args.length ? [...args, actor] : [actor], token);
    // some take no actor
    const r2 = !unwrap(r.json).success ? await rpc(method, args, token) : r;
    const u = unwrap(r2.json);
    add('hr-payroll', name, u.success ? 'PASS' : 'FAIL', { method, error: u.error });
  }

  // staff / leave shared
  await probe('hr', 'staff employees', 'staff:getEmployees', [{}], token);
  await probe('hr', 'leave requests', 'leave:list', [{}, actor], token);

  // —— Accounting ——
  const accFromPos = await probe('accounting', 'sessionFromPos', 'acc:sessionFromPos', [actor], token);
  const accLogin = await rpc('acc:login', [USER, PASS], token);
  if (unwrap(accLogin.json).success) {
    add('accounting', 'acc:login', 'PASS');
  } else {
    add('accounting', 'acc:login', 'WARN', { error: accLogin.json?.error, note: 'POS session bridge may be enough' });
  }
  const accActor = unwrap(accLogin.json).success
    ? (accLogin.json.data?.user || accLogin.json.user || actor)
    : (accFromPos.data?.user || actor);

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;

  const accReads = [
    ['dashboard', 'acc:dashboard', [{}, accActor]],
    ['settings', 'acc:settings', []],
    ['search', 'acc:search', ['', accActor]],
    ['accounts', 'acc:accounts', [{}, accActor]],
    ['journals', 'acc:journals', [{}, accActor]],
    ['ledger', 'acc:ledger', [{}, accActor]],
    ['trialBalance', 'acc:trialBalance', [today, accActor]],
    ['profitLoss', 'acc:profitLoss', [monthStart, today, accActor]],
    ['balanceSheet', 'acc:balanceSheet', [today, accActor]],
    ['cashFlow', 'acc:cashFlow', [monthStart, today, accActor]],
    ['invoices', 'acc:invoices', [{}, accActor]],
    ['bills', 'acc:bills', [{}, accActor]],
    ['payments', 'acc:payments', [{}, accActor]],
    ['agingAr', 'acc:agingAr', [today, accActor]],
    ['agingAp', 'acc:agingAp', [today, accActor]],
    ['bankAccounts', 'acc:bankAccounts', [accActor]],
    ['expenses', 'acc:expenses', [{}, accActor]],
    ['taxSummary', 'acc:taxSummary', [monthStart, today, accActor]],
    ['stockValue', 'acc:stockValue', [accActor]],
    ['audit', 'acc:audit', [{}, accActor]],
    ['integrations', 'acc:integrations', [{}, accActor]],
    ['financialHealth', 'acc:financialHealth', [{}, accActor]],
    ['reconcileCentre', 'acc:reconcileCentre', [accActor]],
    ['bankStmtLines', 'acc:bankStmtLines', [{}, accActor]],
    ['cashupFinance', 'acc:listCashupFinance', [{}, accActor]],
    ['periods', 'acc:periods', [accActor]],
    ['assets', 'acc:assets', [accActor]],
    ['documents', 'acc:documents', [{}, accActor]],
    ['approvals', 'acc:approvals', [{}, accActor]],
    ['creditNotes', 'acc:creditNotes', [{}, accActor]],
    ['debitNotes', 'acc:debitNotes', [accActor]],
    ['refunds', 'acc:refunds', [accActor]]
  ];
  for (const [name, method, args] of accReads) {
    await probe('accounting', name, method, args, token);
  }

  // —— Bookkeeping (POS page) ——
  const bkReads = [
    ['categories', 'bookkeeping:categories', []],
    ['settings', 'bookkeeping:getSettings', []],
    ['dashboard', 'bookkeeping:dashboard', [monthStart, today]],
    ['notifications', 'bookkeeping:notifications', []],
    ['income', 'bookkeeping:getIncome', [{}]],
    ['bank', 'bookkeeping:getBank', [{}]],
    ['cashBook', 'bookkeeping:cashBook', [monthStart, today]],
    ['bankBook', 'bookkeeping:bankBook', [monthStart, today]],
    ['payrollAccounting', 'bookkeeping:payrollAccounting', [monthStart, today]],
    ['taxSummary', 'bookkeeping:taxSummary', [monthStart, today]],
    ['report pnl', 'bookkeeping:report', ['pnl', monthStart, today]],
    ['performance', 'bookkeeping:performance', [monthStart, today]],
    ['budgets', 'bookkeeping:getBudgets', [today.slice(0, 7)]],
    ['budgetVsActual', 'bookkeeping:budgetVsActual', [today.slice(0, 7)]],
    ['documents', 'bookkeeping:getDocuments', [{}]],
    ['auditTrail', 'bookkeeping:auditTrail', [{}]],
    ['sync (legacy)', 'bookkeeping:sync', [monthStart, today]]
  ];
  for (const [name, method, args] of bkReads) {
    await probe('bookkeeping', name, method, args, token);
  }

  // Cross-links
  await probe('cross', 'expenses list (POS)', 'expenses:get', [{}], token);
  await probe('cross', 'sales recent', 'sales:get', [{ limit: 5 }, actor], token);

  // Summary
  const summary = summarize(results);
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  const failPath = require('path').join(__dirname, 'live-hr-acc-referral-report.json');
  require('fs').writeFileSync(failPath, JSON.stringify({ url: BASE, at: new Date().toISOString(), summary, results }, null, 2));
  console.log(`\nWrote ${failPath}`);
  process.exit(summary.FAIL > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

function summarize(rows) {
  const byMod = {};
  const counts = { PASS: 0, FAIL: 0, WARN: 0 };
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    byMod[r.module] = byMod[r.module] || { PASS: 0, FAIL: 0, WARN: 0 };
    byMod[r.module][r.status] = (byMod[r.module][r.status] || 0) + 1;
  }
  return { ...counts, byModule: byMod, fails: rows.filter((r) => r.status === 'FAIL') };
}
