/**
 * Employee document centre: existing employee record, secure link, OTP, signed PDF.
 * Usage: node scripts/test-hr-doc-centre.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-docs-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  process.env.HR_DOC_OTP_DEBUG = '1';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const docs = require('../electron/services/hr-doc-centre');
  const owner = { id: 1, role: 'owner', username: 'owner', full_name: 'Owner' };
  const cashier = { id: 2, role: 'cashier', username: 'cashier', full_name: 'Cashier' };

  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`)
    .run('owner', 'x', 'Owner', 'owner');
  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)`)
    .run('cashier', 'x', 'Cashier', 'cashier');
  const employeeId = db.prepare(`INSERT INTO employees (employee_code, full_name, phone, position, branch, status, basic_salary)
    VALUES (?,?,?,?,?,?,?)`).run('E-DOC-1', 'Test Cook', '0830000000', 'Cook', 'Main', 'Active', 9999).lastInsertRowid;

  docs.ensureDocCentre();
  assert(docs.CATALOG.length === 47, 'template inventory must stay at 47');
  const templates = docs.listTemplates(owner);
  assert(templates.length === 47, 'templates were not seeded');
  assert(templates.some((row) => row.code === 'employment-contract'), 'employment contract template missing');

  let cashierBlocked = false;
  try { docs.dashboard(cashier); } catch (err) { cashierBlocked = /authorized/i.test(err.message); }
  assert(cashierBlocked, 'cashier opened employee documents');

  const issued = await docs.issue(owner, { code: 'code-of-conduct', employee_id: employeeId, expires_days: 7 });
  assert(issued.url.includes('/hr-sign/?t='), 'signing link missing');
  assert(!issued.url.includes('E-DOC-1') && !/[?&](employee_id|salary)=/.test(issued.url), 'link exposed an employee identifier');
  const token = issued.url.split('t=')[1];
  assert(token.length >= 64, 'token is too short');

  const view = docs.publicDoc(token);
  const viewText = JSON.stringify(view);
  assert(!viewText.includes('9999'), 'public page exposed salary');
  assert(!viewText.includes('0830000000'), 'public page exposed the phone');
  assert(!viewText.includes('"id"'), 'public page exposed an employee id');
  assert(view.employee_name === 'Test Cook', 'employee name missing');
  assert(/ordinary electronic signature/i.test(view.consent), 'consent does not describe the signature type');

  let noOtp = false;
  try {
    await docs.publicSubmit(token, { consent: true, signature: 'data:image/png;base64,abc', fields: { acknowledged: true } });
  } catch (err) { noOtp = /code/i.test(err.message); }
  assert(noOtp, 'submit without a code was accepted');

  const otp = await docs.publicOtp(token);
  assert(otp.code && otp.code.length === 6, 'test code was not returned');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const submitted = await docs.publicSubmit(token, {
    consent: true,
    code: otp.code,
    signature: png,
    fields: { acknowledged: true, notes: 'Read' }
  });
  assert(submitted.reference === `HR-${issued.id}`, 'submission reference mismatch');

  let again = false;
  try { await docs.publicSubmit(token, { consent: true, code: otp.code, signature: png, fields: { acknowledged: true } }); }
  catch (err) { again = /already|no longer/i.test(err.message); }
  assert(again, 'the same link was submitted twice');

  const file = docs.pdfForToken(token);
  assert(file.sha256 && file.sha256.length === 64, 'content hash missing');
  assert(Buffer.from(file.pdf_base64, 'base64').slice(0, 4).toString() === '%PDF', 'stored file is not a PDF');
  const employee = db.prepare('SELECT status, basic_salary FROM employees WHERE id = ?').get(employeeId);
  assert(employee.status === 'Active' && Number(employee.basic_salary) === 9999, 'signing changed the employee record');

  const second = await docs.issue(owner, { code: 'leave-request', employee_id: employeeId });
  const secondToken = second.url.split('t=')[1];
  docs.setStatus(owner, second.id, 'revoked');
  let revoked = false;
  try { docs.publicDoc(secondToken); } catch (err) { revoked = /no longer/i.test(err.message); }
  assert(revoked, 'revoked link still opened');

  const third = await docs.issue(owner, { code: 'handbook-acknowledgement', employee_id: employeeId });
  db.prepare(`UPDATE hr_external_links SET expires_at = ? WHERE id = ?`).run('2000-01-01T00:00:00.000Z', third.id);
  let expired = false;
  try { docs.publicDoc(third.url.split('t=')[1]); } catch (err) { expired = /expired/i.test(err.message); }
  assert(expired, 'expired link still opened');

  const managerDoc = await docs.issue(owner, { code: 'attendance-register', employee_id: employeeId });
  assert(!managerDoc.url, 'a manager register was given a public link');
  let managerPublic = false;
  try { docs.publicDoc(db.prepare('SELECT token FROM hr_external_links WHERE id = ?').get(managerDoc.id).token); }
  catch (err) { managerPublic = /inside HR/i.test(err.message); }
  assert(managerPublic, 'manager register opened on the public page');
  const completed = await docs.staffComplete(owner, managerDoc.id, { note: 'Morning register' });
  assert(completed.submitted, 'manager record did not complete');

  const board = docs.dashboard(owner);
  assert(board.templates === 47, 'dashboard template count is wrong');
  assert(board.completed >= 2, 'completed count is not live');
  assert(board.revoked >= 1, 'revoked count is not live');
  assert(board.expired >= 1, 'expired count is not live');
  assert(!JSON.stringify(board).includes('9999'), 'dashboard exposed salary');

  const contract = await docs.issue(owner, { code: 'employment-contract', employee_id: employeeId });
  assert(contract.url, 'contract link missing');
  const after = db.prepare('SELECT status FROM employees WHERE id = ?').get(employeeId);
  assert(after.status === 'Active', 'issuing a contract changed employment status');

  console.log('HR_DOC_CENTRE_OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
