/**
 * Reproduce staff:saveEmployee operator error against live Railway RPC.
 */
const BASE = process.env.SHOP_POS_URL || 'https://chisafood.up.railway.app';

async function rpc(method, args, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-Session-Token'] = token;
  const r = await fetch(BASE + '/rpc', {
    method: 'POST',
    headers,
    body: JSON.stringify({ method, args })
  });
  const j = await r.json();
  const tok = r.headers.get('X-Session-Token') || j.sessionToken || token;
  return { j, token: tok };
}

(async () => {
  // Login as owner — try common test creds from prior chat; env override
  const user = process.env.TEST_USER || 'owner';
  const pass = process.env.TEST_PASS || 'owner123';
  let login = await rpc('auth:login', [user, pass]);
  if (!login.j.success) {
    login = await rpc('auth:login', ['admin', 'admin123']);
  }
  if (!login.j.success) {
    console.log('LOGIN FAIL', login.j.error);
    console.log('Create a shop first or set TEST_USER / TEST_PASS');
    process.exit(1);
  }
  const token = login.token;
  const actor = login.j.data;
  console.log('logged in as', actor?.username || actor?.full_name, actor?.role);

  const create = await rpc(
    'staff:saveEmployee',
    [
      {
        full_name: 'Test Emp Edit',
        position: 'Cashier',
        status: 'Active',
        employment_type: 'Permanent',
        salary_type: 'Monthly',
        basic_salary: 100,
        pin: '1234'
      },
      actor
    ],
    token
  );
  console.log('CREATE', create.j.success ? 'ok id=' + create.j.data?.id : create.j.error);
  if (!create.j.success) process.exit(1);
  const id = create.j.data.id;

  const update = await rpc(
    'staff:saveEmployee',
    [
      {
        id,
        full_name: 'Test Emp Edit Updated',
        position: 'Supervisor',
        status: 'Active',
        employment_type: 'Permanent',
        salary_type: 'Monthly',
        basic_salary: 200,
        phone: '0710000000'
      },
      actor
    ],
    token
  );
  console.log('UPDATE', update.j.success ? 'ok' : update.j.error);

  const sched = await rpc(
    'staff:saveEmployeeWorkSchedule',
    [
      id,
      {
        pay_type: 'monthly',
        monthly_salary: 200,
        expected_hours_per_day: 8,
        work_days: [1, 2, 3, 4, 5],
        shift_start: '08:00',
        shift_end: '17:00'
      },
      actor
    ],
    token
  );
  console.log('SCHEDULE', sched.j.success ? 'ok' : sched.j.error);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
