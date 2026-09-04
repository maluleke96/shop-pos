/**
 * Canonical public URL for Chisa Food cloud (Railway).
 * Override with SHOP_POS_PUBLIC_URL or RAILWAY_PUBLIC_DOMAIN in production.
 */
const DEFAULT_PUBLIC_URL = 'https://chisafood.up.railway.app';

function getPublicUrl() {
  const railwayDomain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  return (
    process.env.SHOP_POS_PUBLIC_URL ||
    process.env.SHOP_POS_SYNC_URL ||
    (railwayDomain ? `https://${railwayDomain}` : '') ||
    DEFAULT_PUBLIC_URL
  ).replace(/\/$/, '');
}

function getRpcUrl() {
  return (
    process.env.SHOP_POS_PUBLIC_RPC_URL ||
    process.env.SHOP_POS_RPC_URL ||
    `${getPublicUrl()}/rpc`
  ).replace(/\/$/, '');
}

module.exports = {
  DEFAULT_PUBLIC_URL,
  getPublicUrl,
  getRpcUrl
};
