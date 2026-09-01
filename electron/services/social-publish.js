/**
 * Real social publishing via Meta Graph API (Facebook Pages + Instagram Business).
 * Tokens live in mkt_settings.settings_json.social (Marketing Command Centre → Settings).
 */
const { getDb } = require('../database/db');

function envVar(name) {
  try {
    return typeof process !== 'undefined' && process.env ? (process.env[name] || '') : '';
  } catch (_) { return ''; }
}

function readSettingsJson() {
  try {
    const row = getDb().prepare('SELECT settings_json FROM mkt_settings WHERE id = 1').get() || {};
    const parsed = typeof row.settings_json === 'string'
      ? JSON.parse(row.settings_json || '{}')
      : (row.settings_json || {});
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function getSocialSettings() {
  const settings = readSettingsJson();
  const social = settings.social && typeof settings.social === 'object' ? settings.social : {};
  return {
    facebook_page_id: social.facebook_page_id || envVar('SHOP_POS_FB_PAGE_ID'),
    facebook_page_token: social.facebook_page_token || envVar('SHOP_POS_FB_PAGE_TOKEN'),
    instagram_account_id: social.instagram_account_id || envVar('SHOP_POS_IG_ACCOUNT_ID'),
    enabled: !!(social.facebook_page_token || envVar('SHOP_POS_FB_PAGE_TOKEN'))
  };
}

function mergeSocialIntoSettingsJson(socialPartial = {}) {
  const db = getDb();
  const existing = readSettingsJson();
  const social = { ...(existing.social || {}), ...socialPartial };
  // Never wipe a token if the UI sends an empty string as "unchanged"
  if (socialPartial.facebook_page_token === '' && existing.social?.facebook_page_token) {
    social.facebook_page_token = existing.social.facebook_page_token;
  }
  const next = { ...existing, social };
  db.prepare(`UPDATE mkt_settings SET settings_json = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(JSON.stringify(next));
  return getSocialSettings();
}

async function graphPost(path, params) {
  const url = new URL(`https://graph.facebook.com/v21.0/${String(path).replace(/^\//, '')}`);
  const body = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v != null && v !== '') body.set(k, String(v));
  });
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json?.error?.message || `Meta Graph error (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

async function publishFacebookPagePost({ message, link, imageUrl }) {
  const cfg = getSocialSettings();
  if (!cfg.facebook_page_id || !cfg.facebook_page_token) {
    throw new Error('Add your Facebook Page ID and Page Access Token under Marketing → Settings');
  }
  if (imageUrl) {
    return graphPost(`${cfg.facebook_page_id}/photos`, {
      url: imageUrl,
      caption: message || '',
      access_token: cfg.facebook_page_token
    });
  }
  return graphPost(`${cfg.facebook_page_id}/feed`, {
    message: message || '',
    link: link || undefined,
    access_token: cfg.facebook_page_token
  });
}

async function publishInstagramPost({ caption, imageUrl }) {
  const cfg = getSocialSettings();
  if (!cfg.instagram_account_id || !cfg.facebook_page_token) {
    throw new Error('Add Instagram Business Account ID and Page Access Token under Marketing → Settings');
  }
  if (!imageUrl) throw new Error('Instagram publishing needs a public image URL on the post');
  const container = await graphPost(`${cfg.instagram_account_id}/media`, {
    image_url: imageUrl,
    caption: caption || '',
    access_token: cfg.facebook_page_token
  });
  return graphPost(`${cfg.instagram_account_id}/media_publish`, {
    creation_id: container.id,
    access_token: cfg.facebook_page_token
  });
}

/**
 * Publish a stored social post row to the live platform when credentials exist.
 */
async function publishSocialPostRow(post) {
  const platform = String(post?.platform || '').toLowerCase();
  const caption = post?.caption || '';
  const media = post?.media_path || post?.media_url || null;
  const isHttp = media && /^https?:\/\//i.test(String(media));
  const link = post?.link || post?.permalink || null;

  if (platform === 'facebook') {
    const remote = await publishFacebookPagePost({
      message: caption,
      imageUrl: isHttp ? media : null,
      link
    });
    return { published: true, platform, remote };
  }
  if (platform === 'instagram') {
    const remote = await publishInstagramPost({
      caption,
      imageUrl: isHttp ? media : null
    });
    return { published: true, platform, remote };
  }
  return {
    published: false,
    reason: `Live Meta publish supports Facebook and Instagram. "${platform}" was marked published locally only.`
  };
}

module.exports = {
  getSocialSettings,
  mergeSocialIntoSettingsJson,
  publishFacebookPagePost,
  publishInstagramPost,
  publishSocialPostRow
};
