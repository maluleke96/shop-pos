/**
 * Games platform: existing customer points, server prizes, one redemption, lab toggles.
 * Usage: node scripts/test-games-platform.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'games-'));
  process.env.SHOP_POS_DATA = tmp;
  process.env.ENTITLEMENTS_ENFORCE = 'false';
  delete process.env.DATABASE_URL;
  delete process.env.SHOP_POS_DATABASE_URL;

  await require('../electron/database/db').initDatabase();
  const db = require('../electron/database/db').getDb();
  const games = require('../electron/services/games-platform');
  const hash = bcrypt.hashSync('admin-pass', 8);

  const ownerId = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)'
  ).run('owner', hash, 'Main Admin', 'owner').lastInsertRowid;
  const managerId = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)'
  ).run('manager', hash, 'Shop Manager', 'manager').lastInsertRowid;
  const cashierId = db.prepare(
    'INSERT INTO users (username, password_hash, full_name, role, is_active) VALUES (?,?,?,?,1)'
  ).run('cashier', hash, 'Till Cashier', 'cashier').lastInsertRowid;
  const owner = { id: ownerId, role: 'owner', username: 'owner', full_name: 'Main Admin' };
  const manager = { id: managerId, role: 'manager', username: 'manager', full_name: 'Shop Manager' };
  const cashier = { id: cashierId, role: 'cashier', username: 'cashier', full_name: 'Till Cashier' };

  const customerId = db.prepare(
    'INSERT INTO customers (name, phone, email, loyalty_points) VALUES (?,?,?,?)'
  ).run('Happy Maluleke', '0831234567', 'happy@example.com', 100).lastInsertRowid;

  games.ensureGames();
  const pub = games.publicConfig();
  assert(pub.show_button === false, 'website games button must start hidden');
  assert(pub.games_app === true && pub.games_pos === true, 'app and POS stay available');

  let managerBlocked = false;
  try { games.saveSettings({ games_button: true, games_online: true }, manager); } catch (err) {
    managerBlocked = /permission/i.test(err.message);
  }
  assert(managerBlocked, 'manager must not toggle the website button');

  const on = games.saveSettings({ games_button: true, games_online: true }, owner);
  assert(on.games_button && on.games_online, 'owner can turn the website button on');
  assert(games.publicConfig().show_button === true, 'button shows only when both flags are on');
  games.saveSettings({ games_online: false }, owner);
  assert(games.publicConfig().show_button === false, 'turning Games Online off hides the button');
  games.saveSettings({ games_button: false, games_online: false }, owner);

  const board = games.dashboard(owner);
  assert(board.insufficient === true, 'empty dashboard must say insufficient data');
  assert(board.todays_plays === 0 && board.points_spent === 0, 'dashboard invented a number');

  let cashierDash = false;
  try { games.dashboard(cashier); } catch (err) { cashierDash = /permission/i.test(err.message); }
  assert(cashierDash, 'cashier must not open the games dashboard');

  const found = games.searchCustomers(cashier, '083123');
  assert(found.length === 1 && found[0].name === 'Happy Maluleke', 'POS search missed the customer');
  assert(!String(found[0].phone_masked).includes('1234567'), 'search exposed the full phone');
  assert(!JSON.stringify(found).includes('happy@example.com'), 'search exposed the full email');

  const catalog = games.catalog(null, 'app');
  assert(catalog.games.some((g) => g.code === 'wheel'), 'wheel missing from catalog');
  assert(!catalog.games.some((g) => g.code === 'physical'), 'physical game is visible before legal approval');
  assert(!JSON.stringify(catalog).includes('probability'), 'catalog leaked prize odds');

  let physical = false;
  try { games.play('nope', { code: 'physical', idempotency_key: 'phys-1', channel: 'app' }); } catch (err) {
    physical = /legally approved|Sign in required|turned off/i.test(err.message);
  }
  const entry = games.posEntry(cashier, customerId);
  try {
    games.play(entry.token, { code: 'physical', idempotency_key: 'phys-2', channel: 'pos' });
    physical = false;
  } catch (err) {
    physical = /legally approved/i.test(err.message);
  }
  assert(physical, 'paid physical game must stay off');

  const wheel = db.prepare("SELECT id FROM games WHERE code = 'wheel'").get();
  db.prepare('UPDATE game_prizes SET is_active = 0 WHERE game_id = ?').run(wheel.id);
  const only = db.prepare("SELECT id FROM game_prizes WHERE game_id = ? AND name = 'Free chips'").get(wheel.id);
  db.prepare('UPDATE game_prizes SET is_active = 1, stock_total = 1, stock_awarded = 0, probability = 100 WHERE id = ?').run(only.id);

  const first = games.play(entry.token, { code: 'wheel', idempotency_key: 'spin-1', channel: 'pos' });
  assert(first.prize && first.prize.name === 'Free chips', 'server did not award the only prize: ' + JSON.stringify(first.prize));
  assert(first.prize.code && /^GAME-\d{6}$/.test(first.prize.code), 'reward code missing');
  const afterFirst = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId).loyalty_points;
  assert(Number(afterFirst) === 90, 'spin did not deduct 10 points, balance ' + afterFirst);

  const replay = games.play(entry.token, { code: 'wheel', idempotency_key: 'spin-1', channel: 'pos' });
  assert(replay.prize.code === first.prize.code, 'replay created a second reward');
  const afterReplay = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId).loyalty_points;
  assert(Number(afterReplay) === 90, 'replay charged points again');
  const rewardCount = db.prepare('SELECT COUNT(*) AS c FROM game_rewards WHERE code = ?').get(first.prize.code).c;
  assert(Number(rewardCount) === 1, 'duplicate reward row');

  let stockStopped = false;
  try {
    games.play(entry.token, { code: 'wheel', idempotency_key: 'spin-2', channel: 'pos' });
  } catch (err) {
    stockStopped = /no prizes/i.test(err.message);
  }
  assert(stockStopped, 'zero stock still awarded a prize');
  const afterStock = db.prepare('SELECT loyalty_points FROM customers WHERE id = ?').get(customerId).loyalty_points;
  assert(Number(afterStock) === 90, 'failed play kept the points, balance ' + afterStock);

  db.prepare('UPDATE customers SET loyalty_points = 5 WHERE id = ?').run(customerId);
  let poor = false;
  try {
    games.play(entry.token, { code: 'mystery', idempotency_key: 'poor-1', channel: 'app' });
  } catch (err) {
    poor = /insufficient points/i.test(err.message);
  }
  assert(poor, 'play succeeded without enough points');
  db.prepare('UPDATE customers SET loyalty_points = 90 WHERE id = ?').run(customerId);

  const reaction = games.play(entry.token, { code: 'reaction', idempotency_key: 'react-1', channel: 'kiosk' });
  assert(reaction.phase === 'play', 'reaction did not open a server play');
  let early = false;
  try {
    games.play(entry.token, { play_id: reaction.play_id, action: 'tap' });
  } catch (err) {
    early = /wait for go/i.test(err.message);
  }
  assert(early, 'reaction accepted a tap before GO');
  games.play(entry.token, { play_id: reaction.play_id, action: 'arm' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const tapped = games.play(entry.token, { play_id: reaction.play_id, action: 'tap' });
  assert(tapped.reaction_ms >= 80, 'client reaction time was trusted');

  const caught = games.play(entry.token, { code: 'catcher', idempotency_key: 'catch-1', channel: 'app' });
  const fake = games.play(entry.token, { play_id: caught.play_id, score: 99999 });
  assert(Number(fake.score) < 50, 'catcher accepted a fake score ' + fake.score);

  const granted = games.grantPlaysForSale({ customerId, saleId: 9001, total: 200, items: [] });
  assert(granted.granted === 5, 'R200 should grant 5 plays, got ' + granted.granted);
  const againGrant = games.grantPlaysForSale({ customerId, saleId: 9001, total: 200, items: [] });
  assert(againGrant.granted === 0, 'the same sale granted plays twice');
  const partial = games.revokePlaysForSale(9001, 0.4);
  assert(partial.revoked === 0, 'a partial refund removed plays');
  const homeBefore = games.home(entry.token);
  assert(homeBefore.available_plays === 5, 'purchase plays missing, ' + homeBefore.available_plays);
  const revoked = games.revokePlaysForSale(9001, 1);
  assert(revoked.revoked === 5, 'full refund did not clear unused plays');
  assert(games.home(entry.token).available_plays === 0, 'revoked plays are still usable');

  const redeemed = games.redeem(cashier, first.prize.code, { branch_id: null, sale_id: 44 });
  assert(redeemed.status === 'REDEEMED', 'redeem did not mark the reward');
  let twice = false;
  try { games.redeem(cashier, first.prize.code, {}); } catch (err) {
    twice = /already redeemed/i.test(err.message);
  }
  assert(twice, 'the same reward redeemed twice');

  const device = games.registerDevice({ device_id: 'kiosk-1', name: 'Front tablet', platform: 'android', kiosk: true });
  assert(device.status === 'active', 'device did not register');
  games.updateDevice(owner, { device_id: 'kiosk-1', status: 'disabled', name: 'Front tablet' });
  let blockedDevice = false;
  try {
    games.play(entry.token, { code: 'lucky', idempotency_key: 'lucky-1', channel: 'kiosk', device_id: 'kiosk-1', number: 7 });
  } catch (err) {
    blockedDevice = /disabled/i.test(err.message);
  }
  assert(blockedDevice, 'a disabled device could still play');

  const leaders = games.leaderboard('day');
  assert(leaders.players.length > 0, 'leaderboard ignored completed plays');
  assert(leaders.players[0].name === 'Happy M.', 'leaderboard used a private name: ' + leaders.players[0].name);
  assert(!JSON.stringify(leaders).includes('0831234567'), 'leaderboard exposed a phone number');

  const audit = games.adminAudit(owner);
  assert(audit.some((row) => row.action === 'reward_redeemed'), 'redemption was not audited');
  assert(audit.some((row) => row.action === 'games_settings'), 'settings change was not audited');

  const perms = games.PERMISSIONS;
  assert(perms.includes('games.online.toggle') && perms.includes('games.rewards.redeem'), 'permission list is short');

  console.log('GAMES_PLATFORM_OK', first.prize.code, 'players', games.dashboard(owner).total_players);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
