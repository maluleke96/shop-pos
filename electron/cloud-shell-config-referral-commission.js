process.env.SHOP_POS_APP_MODE = 'referral-commission';
process.env.SHOP_POS_SYNC_URL = (
  process.env.SHOP_POS_CLOUD_URL ||
  process.env.SHOP_POS_SYNC_URL ||
  'https://chisafood.up.railway.app'
).replace(/\/$/, '');
require('./referral-commission-shell.js');
