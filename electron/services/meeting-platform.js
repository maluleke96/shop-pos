/**
 * AI Meeting Centre — meetings, audio recording, transcript, AI extraction (when API key configured).
 * Video conferencing: requires WebRTC signaling — see meeting portal status banner.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { assertUserActor } = require('./authz');
const {
  dbGet, dbAll, dbRun, nowIso, parseJson, uid, moduleAudit,
  createModuleSession, resolveModuleSession, hashPassword, verifyPassword, ensureMigration, getModuleSettings
} = require('./biz-modules-common');

const AUDIT = 'meeting_audit_logs';

function auditMeeting(row) { moduleAudit(AUDIT, { module: 'meeting', meeting_id: row.meeting_id, ...row }); }

function recordingsDir() {
  let base;
  try {
    const { getDbDir } = require('../database/db');
    base = getDbDir?.() || path.join(process.cwd(), 'data');
  } catch (_) {
    base = path.join(process.cwd(), 'data');
  }
  const dir = path.join(base, 'assets', 'meetings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function aiConfigured() {
  return !!(process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY);
}

function meetingLogin(username, password) {
  ensureMigration();
  const user = dbGet('SELECT * FROM meeting_centre_users WHERE lower(username) = lower(?) AND is_active = 1', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) throw new Error('Invalid username or password');
  const sess = createModuleSession('meeting_sessions', user.id);
  dbRun('UPDATE meeting_centre_users SET last_login_at = ? WHERE id = ?', [nowIso(), user.id]);
  auditMeeting({ user_id: user.id, user_name: user.username, action: 'login' });
  return {
    token: sess.token,
    user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role },
    ai_available: aiConfigured(),
    video_conferencing: 'NOT_IMPLEMENTED — WebRTC signaling server required (planned: SHOP_POS_MEETING_SIGNAL_URL)'
  };
}

function meetingLogout(token) {
  try {
    dbRun('DELETE FROM meeting_sessions WHERE token_hash = ?', [crypto.createHash('sha256').update(String(token)).digest('hex')]);
  } catch (_) { /* */ }
  return { success: true };
}

function resolveMeetingSession(token) {
  return resolveModuleSession('meeting_sessions', 'meeting_centre_users', token);
}

function listMeetings(token, filters = {}) {
  resolveMeetingSession(token);
  let sql = 'SELECT * FROM meetings WHERE 1=1';
  const params = [];
  if (filters.status) { sql += ' AND status = ?'; params.push(filters.status); }
  if (filters.q) {
    sql += ' AND (title LIKE ? OR agenda LIKE ? OR notes LIKE ?)';
    const q = `%${filters.q}%`;
    params.push(q, q, q);
  }
  sql += ' ORDER BY meeting_date DESC, id DESC LIMIT 100';
  return dbAll(sql, params);
}

function getMeeting(id, token) {
  resolveMeetingSession(token);
  const m = dbGet('SELECT * FROM meetings WHERE id = ?', [id]);
  if (!m) throw new Error('Meeting not found');
  m.participants = dbAll('SELECT * FROM meeting_participants WHERE meeting_id = ?', [id]);
  m.recordings = dbAll('SELECT id, meeting_id, mime_type, size_bytes, duration_seconds, storage_status, created_at FROM meeting_recordings WHERE meeting_id = ?', [id]);
  m.transcript = dbGet('SELECT * FROM meeting_transcripts WHERE meeting_id = ? ORDER BY id DESC LIMIT 1', [id]);
  m.minutes = dbGet('SELECT * FROM meeting_minutes WHERE meeting_id = ? ORDER BY id DESC LIMIT 1', [id]);
  m.extracted_points = dbAll('SELECT * FROM meeting_extracted_points WHERE meeting_id = ? ORDER BY id', [id]);
  m.action_items = dbAll('SELECT * FROM meeting_action_items WHERE meeting_id = ?', [id]);
  m.chat = dbAll('SELECT * FROM meeting_chat_messages WHERE meeting_id = ? ORDER BY id', [id]);
  m.audit = dbAll('SELECT * FROM meeting_audit_logs WHERE meeting_id = ? ORDER BY id DESC LIMIT 30', [id]);
  m.ai_available = aiConfigured();
  m.video_status = 'NOT_IMPLEMENTED';
  return m;
}

function saveMeeting(data, token) {
  const user = resolveMeetingSession(token);
  const title = String(data.title || '').trim();
  if (!title) throw new Error('Meeting title required');
  if (data.id) {
    dbRun(`UPDATE meetings SET title=?, meeting_date=?, meeting_time=?, location=?, category=?, agenda=?, notes=?, status=?, updated_at=? WHERE id=?`,
      [title, data.meeting_date || null, data.meeting_time || null, data.location || null, data.category || null,
        data.agenda || null, data.notes || null, data.status || 'scheduled', nowIso(), data.id]);
    auditMeeting({ meeting_id: data.id, user_id: user.id, user_name: user.full_name || user.username, action: 'meeting_updated' });
    return getMeeting(data.id, token);
  }
  const code = uid('MTG');
  const joinToken = crypto.randomBytes(16).toString('hex');
  const r = dbRun(`INSERT INTO meetings (meeting_code, title, meeting_date, meeting_time, location, category, agenda, notes, organizer_id, organizer_name, join_token, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [code, title, data.meeting_date || null, data.meeting_time || null, data.location || null, data.category || null,
      data.agenda || null, data.notes || null, user.id, user.full_name || user.username, joinToken, 'scheduled']);
  const id = r.lastInsertRowid;
  if (Array.isArray(data.participants)) {
    for (const p of data.participants) {
      dbRun('INSERT INTO meeting_participants (meeting_id, name, email, role) VALUES (?,?,?,?)',
        [id, p.name || 'Participant', p.email || null, p.role || 'participant']);
    }
  }
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'meeting_created' });
  return getMeeting(id, token);
}

function startMeeting(id, token) {
  const user = resolveMeetingSession(token);
  dbRun(`UPDATE meetings SET status = 'live', started_at = ?, recording_consent = 1, updated_at = ? WHERE id = ?`, [nowIso(), nowIso(), id]);
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'recording_started' });
  return getMeeting(id, token);
}

function stopMeeting(id, token) {
  const user = resolveMeetingSession(token);
  const m = dbGet('SELECT started_at FROM meetings WHERE id = ?', [id]);
  let duration = 0;
  if (m?.started_at) duration = Math.max(0, Math.floor((Date.now() - new Date(m.started_at).getTime()) / 1000));
  dbRun(`UPDATE meetings SET status = 'processing', ended_at = ?, duration_seconds = ?, updated_at = ? WHERE id = ?`,
    [nowIso(), duration, nowIso(), id]);
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'recording_stopped' });
  return getMeeting(id, token);
}

function saveRecording(id, token, payload) {
  const user = resolveMeetingSession(token);
  const dataUrl = payload.audio_data || payload.file_data;
  if (!dataUrl) throw new Error('Recording data required');
  const m = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid audio data — expected base64 data URL from MediaRecorder');
  const buf = Buffer.from(m[2], 'base64');
  const ext = m[1].includes('webm') ? 'webm' : 'ogg';
  const rel = `meetings/${id}/${Date.now()}.${ext}`;
  const full = path.join(recordingsDir(), '..', rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buf);
  const r = dbRun(`INSERT INTO meeting_recordings (meeting_id, file_path, mime_type, size_bytes, duration_seconds) VALUES (?,?,?,?,?)`,
    [id, rel, m[1], buf.length, Number(payload.duration_seconds) || 0]);
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'recording_saved', entity_id: r.lastInsertRowid });
  return { recording_id: r.lastInsertRowid, file_path: rel, size_bytes: buf.length };
}

function saveTranscript(id, token, segments) {
  const user = resolveMeetingSession(token);
  const segs = Array.isArray(segments) ? segments : [];
  const raw = segs.map((s) => `[${s.speaker || 'Speaker'}] ${s.text || ''}`).join('\n');
  const existing = dbGet('SELECT id FROM meeting_transcripts WHERE meeting_id = ?', [id]);
  if (existing) {
    dbRun('UPDATE meeting_transcripts SET content_json = ?, raw_text = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify(segs), raw, nowIso(), existing.id]);
  } else {
    dbRun('INSERT INTO meeting_transcripts (meeting_id, content_json, raw_text) VALUES (?,?,?)',
      [id, JSON.stringify(segs), raw]);
  }
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'transcript_saved' });
  return { success: true, segment_count: segs.length };
}

async function processMeetingAi(id, token) {
  const user = resolveMeetingSession(token);
  if (!aiConfigured()) {
    return {
      success: false,
      status: 'NOT_IMPLEMENTED',
      message: 'AI processing requires SHOP_POS_AI_API_KEY or OPENAI_API_KEY environment variable on the server.'
    };
  }
  const transcript = dbGet('SELECT * FROM meeting_transcripts WHERE meeting_id = ? ORDER BY id DESC LIMIT 1', [id]);
  if (!transcript?.raw_text) throw new Error('Transcript required before AI processing — upload recording and add/edit transcript first');
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  const prompt = `Analyze this meeting transcript and return JSON with keys: executive_summary, discussion_points (array), decisions (array), action_items (array of {person, task, deadline}), questions (array), risks (array), financial_points (array), next_meeting. Only include what was actually said. Transcript:\n\n${transcript.raw_text}`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' }
      })
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || 'AI API error');
    const content = JSON.parse(json.choices?.[0]?.message?.content || '{}');
    dbRun('UPDATE meeting_transcripts SET ai_processed = 1, updated_at = ? WHERE id = ?', [nowIso(), transcript.id]);
    const types = [
      ['DISCUSSION', content.discussion_points],
      ['DECISION', content.decisions],
      ['QUESTION', content.questions],
      ['RISK', content.risks],
      ['INVESTMENT', content.financial_points]
    ];
    for (const [type, items] of types) {
      for (const item of (items || [])) {
        const text = typeof item === 'string' ? item : item.text || JSON.stringify(item);
        dbRun(`INSERT INTO meeting_extracted_points (meeting_id, point_type, content) VALUES (?,?,?)`, [id, type, text]);
      }
    }
    for (const ai of (content.action_items || [])) {
      dbRun(`INSERT INTO meeting_action_items (meeting_id, person, task, deadline, status) VALUES (?,?,?,?,?)`,
        [id, ai.person || null, ai.task || String(ai), ai.deadline || null, 'pending']);
    }
    const minutesHtml = buildMinutesHtml(content);
    const existing = dbGet('SELECT id FROM meeting_minutes WHERE meeting_id = ?', [id]);
    if (existing) {
      dbRun('UPDATE meeting_minutes SET content_html = ?, content_json = ?, updated_at = ? WHERE id = ?',
        [minutesHtml, JSON.stringify(content), nowIso(), existing.id]);
    } else {
      dbRun('INSERT INTO meeting_minutes (meeting_id, content_html, content_json) VALUES (?,?,?)',
        [id, minutesHtml, JSON.stringify(content)]);
    }
    dbRun('UPDATE meetings SET status = ?, updated_at = ? WHERE id = ?', ['completed', nowIso(), id]);
    auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'ai_processed' });
    return { success: true, summary: content };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function buildMinutesHtml(content) {
  const section = (title, items) => {
    if (!items?.length) return '';
    return `<h3>${title}</h3><ul>${items.map((i) => `<li>${typeof i === 'string' ? i : (i.task || i.text || JSON.stringify(i))}</li>`).join('')}</ul>`;
  };
  return `<h2>Meeting Minutes</h2><p>${content.executive_summary || ''}</p>`
    + section('Key Discussion Points', content.discussion_points)
    + section('Decisions', content.decisions)
    + section('Questions', content.questions)
    + section('Risks / Concerns', content.risks)
    + (content.next_meeting ? `<h3>Next Meeting</h3><p>${content.next_meeting}</p>` : '');
}

function finalizeMinutes(id, token) {
  const user = resolveMeetingSession(token);
  dbRun(`UPDATE meeting_minutes SET status = 'finalized', finalized_by = ?, finalized_at = ?, updated_at = ? WHERE meeting_id = ?`,
    [user.id, nowIso(), nowIso(), id]);
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'minutes_finalized' });
  return { success: true };
}

function searchMeetings(token, query) {
  resolveMeetingSession(token);
  const q = `%${String(query || '').trim()}%`;
  if (!query?.trim()) return [];
  const fromMeetings = dbAll(`SELECT DISTINCT m.* FROM meetings m
    LEFT JOIN meeting_transcripts t ON t.meeting_id = m.id
    LEFT JOIN meeting_extracted_points e ON e.meeting_id = m.id
    WHERE m.title LIKE ? OR m.agenda LIKE ? OR t.raw_text LIKE ? OR e.content LIKE ?
    ORDER BY m.id DESC LIMIT 50`, [q, q, q, q]);
  return fromMeetings;
}

async function askMeetingAi(id, token, question) {
  const user = resolveMeetingSession(token);
  if (!aiConfigured()) {
    return { answer: null, status: 'NOT_IMPLEMENTED', message: 'AI Q&A requires SHOP_POS_AI_API_KEY on server.' };
  }
  const transcript = dbGet('SELECT raw_text FROM meeting_transcripts WHERE meeting_id = ? ORDER BY id DESC LIMIT 1', [id]);
  if (!transcript?.raw_text) return { answer: 'No transcript found for this meeting.', confidence: 'none' };
  const apiKey = process.env.SHOP_POS_AI_API_KEY || process.env.OPENAI_API_KEY;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.SHOP_POS_AI_MODEL || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Based ONLY on this meeting transcript, answer the question. If the answer is not in the transcript, say "I could not find that in the meeting record." Question: ${question}\n\nTranscript:\n${transcript.raw_text}`
      }]
    })
  });
  const json = await res.json();
  const answer = json.choices?.[0]?.message?.content || 'Could not generate answer.';
  auditMeeting({ meeting_id: id, user_id: user.id, user_name: user.full_name || user.username, action: 'ai_question', details: { question } });
  return { answer, confidence: answer.includes('could not find') ? 'not_found' : 'from_transcript' };
}

function saveMeetingUser(data, actor) {
  assertUserActor(actor, ['owner', 'manager']);
  ensureMigration();
  const username = String(data.username || '').trim();
  const fullName = String(data.full_name || username).trim();
  if (!username) throw new Error('Username required');
  if (data.id) {
    const sets = ['full_name = ?', 'role = ?', 'is_active = ?', 'updated_at = ?'];
    const vals = [fullName, data.role || 'meeting_user', data.is_active !== false ? 1 : 0, nowIso()];
    if (data.password) { sets.push('password_hash = ?'); vals.push(hashPassword(data.password)); }
    vals.push(data.id);
    dbRun(`UPDATE meeting_centre_users SET ${sets.join(', ')} WHERE id = ?`, vals);
    return dbGet('SELECT id, username, full_name, role, is_active FROM meeting_centre_users WHERE id = ?', [data.id]);
  }
  if (!data.password || String(data.password).length < 6) throw new Error('Password required');
  const r = dbRun(`INSERT INTO meeting_centre_users (username, password_hash, full_name, role) VALUES (?,?,?,?)`,
    [username, hashPassword(data.password), fullName, data.role || 'meeting_user']);
  return dbGet('SELECT id, username, full_name, role, is_active FROM meeting_centre_users WHERE id = ?', [r.lastInsertRowid]);
}

function listMeetingUsers(actor) {
  assertUserActor(actor, ['owner', 'manager']);
  return dbAll('SELECT id, username, full_name, role, is_active, last_login_at FROM meeting_centre_users ORDER BY full_name');
}

function meetingSummary() {
  ensureMigration();
  const monthStart = new Date();
  monthStart.setDate(1);
  const from = monthStart.toISOString().slice(0, 10);
  const meetingsThisMonth = dbGet('SELECT COUNT(*) AS c FROM meetings WHERE meeting_date >= ?', [from])?.c || 0;
  const outstanding = dbGet("SELECT COUNT(*) AS c FROM meeting_action_items WHERE status = 'pending'")?.c || 0;
  return { meetings_this_month: meetingsThisMonth, outstanding_action_items: outstanding, ai_configured: aiConfigured() };
}

module.exports = {
  meetingLogin, meetingLogout, resolveMeetingSession, listMeetings, getMeeting, saveMeeting,
  startMeeting, stopMeeting, saveRecording, saveTranscript, processMeetingAi,
  finalizeMinutes, searchMeetings, askMeetingAi, saveMeetingUser, listMeetingUsers,
  meetingSummary, aiConfigured
};
