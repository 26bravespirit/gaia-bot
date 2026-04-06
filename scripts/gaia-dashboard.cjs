#!/usr/bin/env node
/**
 * Gaia Dashboard — Unified control center (merged from gaia-dashboard + launcher)
 *
 * Single-file CJS HTTP server with inline HTML/CSS/JS.
 * Port: 3456 (configurable via process.env.PORT)
 *
 * API:
 *   GET  /api/pm2                     PM2 process list
 *   GET  /api/status                  Channel status + subscribe detection + memory summary
 *   POST /api/channel/:name/on|off    Toggle channel
 *   GET  /api/memory/:bot             Detailed memory (users, relationships, promises, self_state)
 *   GET  /api/timings/:bot            Pipeline waterfall data
 *   GET  /api/errors/:bot             Error aggregation from logs
 *   GET  /api/logs/:bot               Log snapshot (last 60 lines)
 *   GET  /api/logs/:bot/stream        SSE live log stream
 *   GET  /api/routing                 Routing rules
 *   POST /api/routing                 Update routing rules (JSON body)
 *   GET  /api/consistency             DB vs Lark API message consistency
 *   GET  /                            Dashboard HTML
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT, 10) || 3456;
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Bot configs ──────────────────────────────────────────────────────
const BOT_CONFIGS = {
  'gaia-bot': {
    db: path.resolve(__dirname, '../data/persona.db'),
    log: path.resolve(__dirname, '../logs/persona-bot.log'),
  },
};

// ── Channel metadata ─────────────────────────────────────────────────
const CHANNELS = {
  feishu: {
    label: 'Gaia Bot',
    configKey: 'channel_feishu_enabled',
    appId: process.env.LARK_APP_ID || 'default',
    brand: process.env.LARK_BRAND || 'lark',
    larkHome: process.env.LARK_HOME || process.env.HOME,
    processPattern: 'node.*dist/index\\.js',
  },
};

// ── DB helpers ───────────────────────────────────────────────────────

function openDb(readonly = false) {
  return new Database(BOT_CONFIGS['gaia-bot'].db, { readonly });
}

function ensureDefaults() {
  const db = openDb(false);
  const upsert = db.prepare(
    'INSERT OR IGNORE INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?)'
  );
  const now = Date.now();
  upsert.run('channel_feishu_enabled', 'true', now);
  upsert.run('routing_rules', JSON.stringify({ default: 'feishu' }), now);
  db.close();
}

function getConfig(db, key) {
  const row = db.prepare('SELECT value FROM runtime_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(db, key, value) {
  db.prepare(
    `INSERT INTO runtime_config (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}

function queryDb(dbPath, sql, params = []) {
  if (!fs.existsSync(dbPath)) return [];
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(sql).all(...params);
    db.close();
    return rows;
  } catch { return []; }
}

// ── Process detection ────────────────────────────────────────────────

function detectProcess(pattern) {
  try {
    const out = execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
    const regex = new RegExp(pattern);
    for (const line of out.split('\n')) {
      if (line.includes('grep') || line.includes('gaia-ctl') || line.includes('gaia-dashboard')) continue;
      if (regex.test(line)) {
        const parts = line.trim().split(/\s+/);
        return { running: true, pid: parseInt(parts[1], 10), cmd: parts.slice(10).join(' ') };
      }
    }
  } catch (_) {}
  return { running: false, pid: null, cmd: null };
}

function detectSubscribe(channel) {
  const ch = CHANNELS[channel];
  try {
    const out = execSync('ps aux', { encoding: 'utf8', timeout: 5000 });
    const pattern = new RegExp(`lark-cli.*subscribe.*${ch.appId}`);
    for (const line of out.split('\n')) {
      if (line.includes('grep')) continue;
      if (pattern.test(line)) {
        const parts = line.trim().split(/\s+/);
        return { active: true, pid: parseInt(parts[1], 10) };
      }
    }
  } catch (_) {}
  return { active: false, pid: null };
}

// ── PM2 helpers ──────────────────────────────────────────────────────

function getPm2List() {
  try {
    return JSON.parse(execSync('npx pm2 jlist 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }));
  } catch { return []; }
}

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

// ── Log reading ──────────────────────────────────────────────────────

function readLogTail(logPath, lines = 50) {
  if (!fs.existsSync(logPath)) return [];
  try {
    const content = execSync(`tail -${lines} "${logPath}"`, { encoding: 'utf-8', timeout: 3000 });
    return content.split('\n').filter(Boolean).map(line => {
      const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\[(\w+)\]\s*(.*)/);
      return m ? { ts: m[1], level: m[2], msg: m[3] } : { ts: '', level: 'info', msg: line };
    });
  } catch { return []; }
}

// ── API handlers ─────────────────────────────────────────────────────

function apiPm2() {
  const list = getPm2List();
  return list.filter(p => !p.name.includes('dashboard') && !p.name.includes('control')).map(p => ({
    name: p.name,
    pid: p.pid,
    status: p.pm2_env?.status || 'unknown',
    uptime: p.pm2_env?.pm_uptime ? fmtUptime(Date.now() - p.pm2_env.pm_uptime) : '-',
    restarts: p.pm2_env?.restart_time || 0,
    memory: p.monit?.memory ? (p.monit.memory / 1024 / 1024).toFixed(1) : '-',
    cpu: p.monit?.cpu !== undefined ? p.monit.cpu : '-',
  }));
}

function apiStatus() {
  const db = openDb(true);
  const channels = {};

  for (const [name, ch] of Object.entries(CHANNELS)) {
    const enabled = getConfig(db, ch.configKey) ?? 'true';
    const proc = detectProcess(ch.processPattern);
    const sub = detectSubscribe(name);
    channels[name] = {
      label: ch.label,
      enabled: enabled === 'true',
      appId: ch.appId,
      brand: ch.brand,
      larkHome: ch.larkHome,
      process: proc,
      subscribe: sub,
    };
  }

  let memory = {};
  try {
    memory.ltmCount = db.prepare('SELECT COUNT(*) as c FROM long_term_memories').get().c;
    memory.bioCount = db.prepare('SELECT COUNT(*) as c FROM biographical_facts WHERE is_active=1').get().c;
    const rel = db.prepare('SELECT stage, intimacy_score, interaction_count FROM relationships LIMIT 1').get();
    if (rel) memory.relationship = rel;
    const self = db.prepare('SELECT mood_baseline, energy_level, social_battery, active_emotions FROM self_state WHERE id=1').get();
    if (self) memory.selfState = self;
  } catch (_) {}

  db.close();
  return { channels, memory };
}

function apiChannelToggle(name, action) {
  if (!CHANNELS[name]) return { error: `unknown channel: ${name}` };
  const db = openDb(false);
  setConfig(db, CHANNELS[name].configKey, action === 'on' ? 'true' : 'false');
  db.close();
  return { ok: true, channel: name, enabled: action === 'on' };
}

function apiMemoryBot(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return {};
  const ltm = queryDb(cfg.db, 'SELECT COUNT(*) as c FROM long_term_memories')[0]?.c || 0;
  const bio = queryDb(cfg.db, 'SELECT COUNT(*) as c FROM biographical_facts WHERE is_active=1')[0]?.c || 0;
  const users = queryDb(cfg.db, 'SELECT user_id, display_name, message_count, relationship_stage FROM users ORDER BY message_count DESC LIMIT 10');
  const rels = queryDb(cfg.db, 'SELECT user_id, stage, intimacy_score, interaction_count FROM relationships ORDER BY interaction_count DESC LIMIT 10');
  const self = queryDb(cfg.db, 'SELECT mood_baseline, energy_level, social_battery, active_emotions FROM self_state WHERE id=1')[0] || {};
  const promises = queryDb(cfg.db, "SELECT content, status FROM long_term_memories WHERE type='promise' ORDER BY created_at DESC LIMIT 5");
  return { ltm, bio, users, relationships: rels, selfState: self, promises };
}

function apiTimings(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return [];
  return queryDb(cfg.db,
    'SELECT message_id, sender_name, total_ms, stages, model, timestamp FROM pipeline_timings ORDER BY timestamp DESC LIMIT 20'
  ).map(r => ({ ...r, stages: JSON.parse(r.stages || '{}') }));
}

function apiErrors(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return { errors: 0, warns: 0, recent: [] };
  const logs = readLogTail(cfg.log, 200);
  const errors = logs.filter(l => l.level === 'error');
  const warns = logs.filter(l => l.level === 'warn');
  return { errors: errors.length, warns: warns.length, recent: errors.slice(-5) };
}

function apiLogs(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return [];
  return readLogTail(cfg.log, 60);
}

function apiRouting() {
  const db = openDb(true);
  const raw = getConfig(db, 'routing_rules');
  db.close();
  try { return JSON.parse(raw); } catch (_) { return {}; }
}

function apiUpdateRouting(body) {
  const db = openDb(false);
  setConfig(db, 'routing_rules', JSON.stringify(body));
  db.close();
  return { ok: true };
}

// ── Consistency check ────────────────────────────────────────────────

const LARK_CLI_BIN = process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
const CONSISTENCY_LARK_HOME = process.env.LARK_HOME || process.env.HOME;
const CONSISTENCY_CHAT_IDS = (process.env.TARGET_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const CONSISTENCY_INTERVAL_MS = 60_000;
const CONSISTENCY_MSG_COUNT = 100;

let consistencyCache = null;
let consistencyLastRun = 0;

function larkCliListMessages(chatId, pageSize) {
  const env = { ...process.env, HOME: CONSISTENCY_LARK_HOME, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' };
  try {
    const out = execFileSync(LARK_CLI_BIN, [
      'im', '+chat-messages-list',
      '--chat-id', chatId,
      '--as', 'bot',
      '--page-size', String(pageSize),
      '--sort', 'desc',
      '--format', 'json',
    ], { encoding: 'utf-8', timeout: 15000, env });
    return JSON.parse(out);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function apiConsistency(force) {
  const now = Date.now();
  if (!force && consistencyCache && (now - consistencyLastRun) < CONSISTENCY_INTERVAL_MS) {
    return consistencyCache;
  }

  const db = openDb(true);

  let chatIds = CONSISTENCY_CHAT_IDS;
  if (chatIds.length === 0) {
    try {
      const rows = db.prepare(
        'SELECT chat_id, COUNT(*) as cnt FROM conversation_log GROUP BY chat_id ORDER BY cnt DESC LIMIT 1'
      ).all();
      if (rows.length > 0) chatIds = [rows[0].chat_id];
    } catch (_) {}
  }

  if (chatIds.length === 0) {
    db.close();
    return { ok: false, error: 'no_chat_id', checkedAt: now };
  }

  const chatId = chatIds[0];

  const dbRows = db.prepare(
    'SELECT message_id, role, substr(content, 1, 60) as content, timestamp FROM conversation_log WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(chatId, CONSISTENCY_MSG_COUNT);
  db.close();

  const dbIds = new Set(dbRows.map(r => r.message_id));
  const dbCount = dbRows.length;

  const larkResult = larkCliListMessages(chatId, 50);
  if (!larkResult.ok) {
    consistencyCache = { ok: false, error: larkResult.error?.message || 'lark_api_failed', chatId, checkedAt: now };
    consistencyLastRun = now;
    return consistencyCache;
  }

  let larkMessages = larkResult.data?.messages || [];

  if (larkResult.data?.has_more && larkMessages.length < CONSISTENCY_MSG_COUNT && larkResult.data?.page_token) {
    try {
      const env = { ...process.env, HOME: CONSISTENCY_LARK_HOME, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' };
      const out2 = execFileSync(LARK_CLI_BIN, [
        'im', '+chat-messages-list',
        '--chat-id', chatId,
        '--as', 'bot',
        '--page-size', '50',
        '--sort', 'desc',
        '--page-token', larkResult.data.page_token,
        '--format', 'json',
      ], { encoding: 'utf-8', timeout: 15000, env });
      const page2 = JSON.parse(out2);
      if (page2.ok && page2.data?.messages) {
        larkMessages = larkMessages.concat(page2.data.messages);
      }
    } catch (_) {}
  }

  const larkIds = new Set(larkMessages.map(m => m.message_id));
  const larkCount = larkMessages.length;

  const inDbNotLark = [...dbIds].filter(id => !larkIds.has(id));
  const inLarkNotDb = [...larkIds].filter(id => !dbIds.has(id));
  const matched = [...dbIds].filter(id => larkIds.has(id)).length;

  const dbUser = dbRows.filter(r => r.role === 'user').length;
  const dbBot = dbRows.filter(r => r.role === 'assistant').length;
  const larkUser = larkMessages.filter(m => m.sender?.sender_type === 'user').length;
  const larkBot = larkMessages.filter(m => m.sender?.sender_type === 'app').length;

  const isHealthy = inDbNotLark.length === 0 && inLarkNotDb.length === 0;

  consistencyCache = {
    ok: true,
    healthy: isHealthy,
    chatId,
    checkedAt: now,
    db: { total: dbCount, user: dbUser, bot: dbBot },
    lark: { total: larkCount, user: larkUser, bot: larkBot },
    matched,
    inDbNotLark,
    inLarkNotDb,
  };
  consistencyLastRun = now;
  return consistencyCache;
}

// ── SSE Log Stream ───────────────────────────────────────────────────

const sseClients = new Map(); // botName -> Set<res>

function startLogWatchers() {
  for (const [name, cfg] of Object.entries(BOT_CONFIGS)) {
    if (!fs.existsSync(cfg.log)) continue;
    sseClients.set(name, new Set());
    let lastSize = fs.statSync(cfg.log).size;

    fs.watchFile(cfg.log, { interval: 1000 }, (curr) => {
      if (curr.size <= lastSize) { lastSize = curr.size; return; }
      const stream = fs.createReadStream(cfg.log, { start: lastSize, encoding: 'utf-8' });
      let buf = '';
      stream.on('data', chunk => buf += chunk);
      stream.on('end', () => {
        lastSize = curr.size;
        const lines = buf.split('\n').filter(Boolean);
        const clients = sseClients.get(name);
        if (!clients?.size) return;
        for (const line of lines) {
          const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\[(\w+)\]\s*(.*)/);
          const data = m
            ? JSON.stringify({ ts: m[1], level: m[2], msg: m[3] })
            : JSON.stringify({ ts: '', level: 'info', msg: line });
          for (const client of clients) {
            client.write(`data: ${data}\n\n`);
          }
        }
      });
    });
  }
}

// ── HTML page ────────────────────────────────────────────────────────

function getHtmlPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gaia Dashboard</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #232736;
    --border: #2d3148;
    --text: #e1e4ed;
    --text2: #8b90a5;
    --green: #34d399;
    --red: #f87171;
    --blue: #60a5fa;
    --yellow: #fbbf24;
    --purple: #a78bfa;
    --cyan: #22d3ee;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    padding: 24px;
    min-height: 100vh;
  }
  .container { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 22px; font-weight: 600; margin-bottom: 4px; letter-spacing: -0.5px; }
  .subtitle { color: var(--text2); font-size: 13px; margin-bottom: 24px; }
  .subtitle .dot {
    display: inline-block; width: 6px; height: 6px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
  .subtitle .dot.live { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  /* Bot / PM2 cards grid */
  .bots { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }
  .bot-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }
  .bot-card h2 {
    font-size: 16px; font-weight: 500; margin-bottom: 12px;
    display: flex; align-items: center; gap: 8px;
  }
  .badge {
    display: inline-block; padding: 2px 10px; border-radius: 999px;
    font-size: 12px; font-weight: 500;
  }
  .badge.on  { background: rgba(52,211,153,0.15); color: var(--green); }
  .badge.off { background: rgba(248,113,113,0.15); color: var(--red); }

  .row {
    display: flex; justify-content: space-between; padding: 5px 0;
    font-size: 13px; border-bottom: 1px solid var(--border);
  }
  .row:last-child { border-bottom: none; }
  .row .k { color: var(--text2); }
  .row .v { font-family: "SF Mono", Menlo, monospace; font-size: 12px; }

  .status-dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
  .status-dot.on  { background: var(--green); }
  .status-dot.off { background: var(--red); }
  .status-dot.idle { background: var(--text2); }

  .toggle-btn {
    display: inline-block; padding: 6px 20px; border: none; border-radius: 8px;
    font-size: 13px; font-weight: 500; cursor: pointer;
    transition: all 0.2s; margin-top: 8px; margin-right: 8px;
  }
  .toggle-btn.enable  { background: rgba(52,211,153,0.15); color: var(--green); }
  .toggle-btn.disable { background: rgba(248,113,113,0.15); color: var(--red); }
  .toggle-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
  .toggle-btn:active { transform: translateY(0); }

  /* Bot selector */
  .tab-select { display: flex; gap: 4px; margin-bottom: 12px; }
  .tab-select button {
    padding: 4px 12px; border-radius: 6px; font-size: 12px;
    cursor: pointer; color: var(--text2); background: transparent;
    border: 1px solid var(--border); transition: all 0.2s;
  }
  .tab-select button.active { background: var(--surface2); color: var(--text); }

  /* Tabs */
  .tabs {
    display: flex; gap: 4px; margin-bottom: 16px;
    border-bottom: 1px solid var(--border); padding-bottom: 8px;
  }
  .tab {
    padding: 6px 16px; border-radius: 8px; font-size: 13px;
    cursor: pointer; color: var(--text2); background: transparent;
    border: none; transition: all 0.2s;
  }
  .tab:hover { color: var(--text); }
  .tab.active { background: var(--surface2); color: var(--text); }

  /* Panels */
  .panel {
    display: none; background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px; margin-bottom: 16px;
  }
  .panel.active { display: block; }

  /* Memory cards */
  .mem-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin-bottom: 16px; }
  .mem-card {
    background: var(--surface2); border-radius: 10px; padding: 14px; text-align: center;
  }
  .mem-card .num { font-size: 26px; font-weight: 700; font-family: "SF Mono", Menlo, monospace; }
  .mem-card .lbl { color: var(--text2); font-size: 11px; margin-top: 2px; }
  .green .num { color: var(--green); }
  .blue .num  { color: var(--blue); }
  .purple .num { color: var(--purple); }
  .yellow .num { color: var(--yellow); }
  .red .num { color: var(--red); }
  .cyan .num { color: var(--cyan); }

  /* Users table */
  table { width: 100%; font-size: 13px; border-collapse: collapse; }
  th { text-align: left; color: var(--text2); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 6px 8px; border-bottom: 1px solid var(--surface2); }

  /* Waterfall */
  .wf-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 12px; border-bottom: 1px solid var(--surface2); }
  .wf-sender { width: 80px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wf-bars { flex: 1; display: flex; height: 18px; border-radius: 4px; overflow: hidden; }
  .wf-bar {
    height: 100%; min-width: 2px; display: flex; align-items: center;
    justify-content: center; font-size: 9px; color: #fff; overflow: hidden;
  }
  .wf-total { width: 50px; text-align: right; font-family: "SF Mono", Menlo, monospace; color: var(--text2); }
  .wf-bar.s1 { background: #3b82f6; }
  .wf-bar.s2 { background: #8b5cf6; }
  .wf-bar.s3s4 { background: #f59e0b; }
  .wf-bar.s5 { background: #22c55e; }
  .wf-bar.s55 { background: #06b6d4; }
  .wf-bar.s6 { background: #ef4444; }
  .wf-legend { display: flex; gap: 12px; font-size: 11px; color: var(--text2); margin-bottom: 8px; }
  .wf-legend span { display: flex; align-items: center; gap: 4px; }
  .wf-legend i { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

  /* Log box */
  .log-box {
    background: #0c0e14; border-radius: 8px; padding: 12px;
    max-height: 360px; overflow-y: auto;
    font-family: "SF Mono", Menlo, monospace; font-size: 12px; line-height: 1.7;
  }
  .log-line { white-space: pre-wrap; word-break: break-all; }
  .log-line .ts { color: var(--text2); }
  .log-line .info { color: var(--blue); }
  .log-line .warn { color: var(--yellow); }
  .log-line .error { color: var(--red); }
  .log-filters { display: flex; gap: 8px; margin-bottom: 8px; }
  .log-filters label { font-size: 11px; color: var(--text2); display: flex; align-items: center; gap: 4px; cursor: pointer; }
  .log-filters input { accent-color: var(--blue); }

  /* Errors */
  .err-row {
    padding: 8px; background: rgba(248,113,113,0.06); border-radius: 6px;
    margin-bottom: 6px; font-size: 12px; font-family: "SF Mono", Menlo, monospace; color: #fca5a5;
  }

  /* Routing */
  .routing-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 20px;
  }
  .route-row {
    display: flex; align-items: center; gap: 12px; padding: 8px 0;
    border-bottom: 1px solid var(--border); font-size: 13px;
  }
  .route-row:last-child { border-bottom: none; }
  .route-key {
    font-family: "SF Mono", Menlo, monospace; font-size: 12px;
    background: var(--surface2); padding: 3px 8px; border-radius: 4px; min-width: 140px;
  }
  .route-arrow { color: var(--text2); }
  .route-val { font-weight: 500; }
  .routing-editor { margin-top: 12px; }
  .routing-editor textarea {
    width: 100%; height: 80px; background: var(--surface2); color: var(--text);
    border: 1px solid var(--border); border-radius: 8px; padding: 10px;
    font-family: "SF Mono", Menlo, monospace; font-size: 12px; resize: vertical;
  }
  .routing-editor textarea:focus { outline: none; border-color: var(--blue); }

  .save-btn {
    display: inline-block; padding: 6px 20px;
    background: rgba(96,165,250,0.15); color: var(--blue);
    border: none; border-radius: 8px; font-size: 13px; font-weight: 500;
    cursor: pointer; margin-top: 8px; transition: all 0.2s;
  }
  .save-btn:hover { filter: brightness(1.2); }

  /* Consistency */
  .consistency-status {
    display: flex; align-items: center; gap: 10px; padding: 12px 0;
    font-size: 14px; font-weight: 500;
  }
  .consistency-status .icon { font-size: 20px; }
  .consistency-detail {
    display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;
  }
  .consistency-detail .cd-item {
    display: flex; justify-content: space-between; padding: 6px 0;
    border-bottom: 1px solid var(--border); font-size: 13px;
  }
  .consistency-detail .cd-label { color: var(--text2); }
  .consistency-detail .cd-val { font-family: "SF Mono", Menlo, monospace; font-size: 12px; }
  .consistency-missing {
    margin-top: 8px; padding: 8px 12px;
    background: rgba(248,113,113,0.1); border-radius: 8px;
    font-size: 12px; color: var(--red);
    font-family: "SF Mono", Menlo, monospace; word-break: break-all;
  }

  /* Toast */
  .toast {
    position: fixed; bottom: 24px; right: 24px;
    background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); padding: 10px 20px; border-radius: 10px;
    font-size: 13px; opacity: 0; transform: translateY(10px);
    transition: all 0.3s; pointer-events: none; z-index: 999;
  }
  .toast.show { opacity: 1; transform: translateY(0); }

  .section-title {
    font-size: 16px; font-weight: 600; margin: 24px 0 12px;
    padding-bottom: 8px; border-bottom: 1px solid var(--border);
  }
  .refresh-note {
    color: var(--text2); font-size: 11px; text-align: center; margin-top: 24px;
  }
</style>
</head>
<body>
<div class="container">

<h1>Gaia Dashboard</h1>
<div class="subtitle"><span class="dot live"></span>Unified Control Center &mdash; auto-refresh 5s</div>

<!-- PM2 Bot Cards -->
<div class="bots" id="bots"></div>

<!-- Channel Cards (with toggle) -->
<div class="bots" id="channels"></div>

<!-- Bot Selector -->
<div class="tab-select" id="botSelect"></div>

<!-- Tab Bar -->
<div class="tabs" id="tabBar">
  <button class="tab active" onclick="showPanel('pipeline',this)">Pipeline</button>
  <button class="tab" onclick="showPanel('memory',this)">Memory</button>
  <button class="tab" onclick="showPanel('logs',this)">Logs</button>
  <button class="tab" onclick="showPanel('errors',this)">Errors</button>
  <button class="tab" onclick="showPanel('routing',this)">Routing</button>
  <button class="tab" onclick="showPanel('consistency',this)">Consistency</button>
</div>

<!-- Pipeline Panel -->
<div class="panel active" id="panel-pipeline">
  <div class="wf-legend">
    <span><i style="background:#3b82f6"></i>S1</span>
    <span><i style="background:#8b5cf6"></i>S2</span>
    <span><i style="background:#f59e0b"></i>S3S4</span>
    <span><i style="background:#22c55e"></i>S5</span>
    <span><i style="background:#06b6d4"></i>S5.5</span>
    <span><i style="background:#ef4444"></i>S6</span>
  </div>
  <div id="waterfall"></div>
</div>

<!-- Memory Panel -->
<div class="panel" id="panel-memory"><div id="memContent"></div></div>

<!-- Logs Panel -->
<div class="panel" id="panel-logs">
  <div class="log-filters">
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="info">info</label>
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="warn">warn</label>
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="error">error</label>
  </div>
  <div class="log-box" id="logBox"></div>
</div>

<!-- Errors Panel -->
<div class="panel" id="panel-errors"><div id="errContent"></div></div>

<!-- Routing Panel -->
<div class="panel" id="panel-routing"><div id="routingContent"></div></div>

<!-- Consistency Panel -->
<div class="panel" id="panel-consistency"><div id="consistencyContent"></div></div>

<div class="refresh-note" id="refreshNote"></div>
<div class="toast" id="toast"></div>

</div>
<script>
let currentBot = '';
let currentPanel = 'pipeline';
let logLines = [];
let logFilter = {info:true, warn:true, error:true};
let evtSource = null;

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

// ── Channel toggle ──
async function toggleChannel(name, action) {
  await api('/api/channel/' + name + '/' + action, { method: 'POST' });
  showToast((action === 'on' ? 'Enabled' : 'Disabled') + ' ' + name);
  refresh();
}

// ── Tab switching ──
function showPanel(name, btn) {
  currentPanel = name;
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  if (btn) btn.classList.add('active');
  if (name === 'logs') connectSSE();
  if (name === 'routing') refreshRouting();
  if (name === 'consistency') refreshConsistency();
  if (name === 'memory' || name === 'pipeline' || name === 'errors') refreshPanels();
}

// ── Bot selector ──
function selectBot(name) {
  currentBot = name;
  document.querySelectorAll('#botSelect button').forEach(b =>
    b.classList.toggle('active', b.dataset.bot === name)
  );
  refreshPanels();
  if (currentPanel === 'logs') connectSSE();
}

// ── SSE log stream ──
function connectSSE() {
  if (evtSource) evtSource.close();
  if (!currentBot) return;
  logLines = [];
  evtSource = new EventSource('/api/logs/' + currentBot + '/stream');
  evtSource.onmessage = e => {
    const d = JSON.parse(e.data);
    logLines.push(d);
    if (logLines.length > 200) logLines.shift();
    renderLogs();
  };
}

function renderLogs() {
  const box = document.getElementById('logBox');
  const html = logLines
    .filter(l => logFilter[l.level])
    .map(l => '<div class="log-line"><span class="ts">[' + l.ts + ']</span> <span class="' + l.level + '">[' + l.level + ']</span> ' + escHtml(l.msg) + '</div>')
    .join('');
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

function updateLogFilter() {
  document.querySelectorAll('.log-filters input').forEach(cb => {
    logFilter[cb.dataset.level] = cb.checked;
  });
  renderLogs();
}

// ── Render PM2 cards ──
function renderBotCards(bots) {
  let html = '';
  let selectHtml = '';
  for (const b of bots) {
    const on = b.status === 'online';
    html += '<div class="bot-card"><h2>' + escHtml(b.name) + ' <span class="badge ' + (on ? 'on' : 'off') + '">' + (on ? 'ONLINE' : 'OFFLINE') + '</span></h2>';
    html += '<div class="row"><span class="k">PID</span><span class="v">' + b.pid + '</span></div>';
    html += '<div class="row"><span class="k">Uptime</span><span class="v">' + b.uptime + '</span></div>';
    html += '<div class="row"><span class="k">Restarts</span><span class="v">' + b.restarts + '</span></div>';
    html += '<div class="row"><span class="k">Memory</span><span class="v">' + b.memory + ' MB</span></div>';
    html += '<div class="row"><span class="k">CPU</span><span class="v">' + b.cpu + '%</span></div></div>';
    selectHtml += '<button data-bot="' + b.name + '" onclick="selectBot(\\'' + b.name + '\\')" class="' + (b.name === currentBot ? 'active' : '') + '">' + escHtml(b.name) + '</button>';
  }
  document.getElementById('bots').innerHTML = html;
  document.getElementById('botSelect').innerHTML = selectHtml;
  if (!currentBot && bots.length) selectBot(bots[0].name);
}

// ── Render channel cards with toggle ──
function renderChannels(channels) {
  const el = document.getElementById('channels');
  let html = '';
  for (const [name, ch] of Object.entries(channels)) {
    const onClass = ch.enabled ? 'on' : 'off';
    const onText = ch.enabled ? 'ON' : 'OFF';
    const procDot = ch.process.running ? 'on' : 'idle';
    const procText = ch.process.running ? 'Running (PID ' + ch.process.pid + ')' : 'Not running';
    const subDot = ch.subscribe.active ? 'on' : 'idle';
    const subText = ch.subscribe.active ? 'Active (PID ' + ch.subscribe.pid + ')' : 'None';

    html += '<div class="bot-card">';
    html += '<h2>' + escHtml(ch.label) + ' <span class="badge ' + onClass + '">' + onText + '</span></h2>';
    html += '<div class="row"><span class="k">Channel</span><span class="v">' + name + '</span></div>';
    html += '<div class="row"><span class="k">Process</span><span class="v"><span class="status-dot ' + procDot + '"></span>' + procText + '</span></div>';
    html += '<div class="row"><span class="k">Subscribe</span><span class="v"><span class="status-dot ' + subDot + '"></span>' + subText + '</span></div>';
    html += '<div class="row"><span class="k">AppID</span><span class="v">' + ch.appId + '</span></div>';
    html += '<div class="row"><span class="k">Brand</span><span class="v">' + ch.brand + '</span></div>';

    if (ch.enabled) {
      html += '<button class="toggle-btn disable" onclick="toggleChannel(\\'' + name + '\\',\\'off\\')">Disable</button>';
    } else {
      html += '<button class="toggle-btn enable" onclick="toggleChannel(\\'' + name + '\\',\\'on\\')">Enable</button>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
}

// ── Render memory summary in channel status ──
function renderMemorySummary(mem) {
  // Shown as small stats in the channel area, not the full memory panel
}

// ── Pipeline waterfall ──
function renderWaterfall(timings) {
  const stageMap = {
    'S1:MessageDispatcher':'s1','S2:ContextAssembler':'s2',
    'S3S4:CognitiveGenerator':'s3s4','S4.5:BiographicalExtractor':'s2',
    'S4.6:MemoryExtractor':'s2','S5:PerceptionWrapper':'s5',
    'S5.5:AntiAiValidator':'s55','S6:OutboundScheduler':'s6'
  };
  let wf = '';
  for (const t of timings) {
    const maxMs = Math.max(t.total_ms, 1);
    let bars = '';
    for (const [stage, ms] of Object.entries(t.stages)) {
      const pct = Math.max((ms / maxMs) * 100, 3);
      const cls = stageMap[stage] || 's2';
      bars += '<div class="wf-bar ' + cls + '" style="width:' + pct + '%" title="' + stage + ': ' + ms + 'ms">' + (ms > 200 ? ms + '' : '') + '</div>';
    }
    wf += '<div class="wf-row"><span class="wf-sender">' + escHtml(t.sender_name || '?') + '</span><div class="wf-bars">' + bars + '</div><span class="wf-total">' + t.total_ms + 'ms</span></div>';
  }
  document.getElementById('waterfall').innerHTML = wf || '<div style="color:var(--text2);font-size:13px">No pipeline data yet</div>';
}

// ── Detailed memory panel ──
function renderMemoryPanel(mem) {
  let h = '<div class="mem-grid">';
  h += '<div class="mem-card green"><div class="num">' + (mem.ltm || 0) + '</div><div class="lbl">Long-term</div></div>';
  h += '<div class="mem-card blue"><div class="num">' + (mem.bio || 0) + '</div><div class="lbl">Bio Facts</div></div>';
  const ss = mem.selfState || {};
  h += '<div class="mem-card yellow"><div class="num">' + (typeof ss.mood_baseline === 'number' ? ss.mood_baseline.toFixed(2) : '-') + '</div><div class="lbl">Mood</div></div>';
  h += '<div class="mem-card purple"><div class="num">' + (typeof ss.social_battery === 'number' ? ss.social_battery.toFixed(2) : '-') + '</div><div class="lbl">Battery</div></div>';
  h += '<div class="mem-card cyan"><div class="num">' + (typeof ss.energy_level === 'number' ? ss.energy_level.toFixed(2) : '-') + '</div><div class="lbl">Energy</div></div>';
  h += '</div>';

  if (mem.users?.length) {
    h += '<h3 style="font-size:14px;color:var(--text2);margin:12px 0 8px">Users</h3>';
    h += '<table><tr><th>Name</th><th>Messages</th><th>Stage</th><th>Intimacy</th></tr>';
    const relMap = {};
    (mem.relationships || []).forEach(r => relMap[r.user_id] = r);
    for (const u of mem.users) {
      const r = relMap[u.user_id] || {};
      h += '<tr><td>' + escHtml(u.display_name || u.user_id.slice(0, 8)) + '</td>';
      h += '<td>' + u.message_count + '</td>';
      h += '<td>' + (r.stage || u.relationship_stage || '-') + '</td>';
      h += '<td>' + (typeof r.intimacy_score === 'number' ? r.intimacy_score.toFixed(2) : '-') + '</td></tr>';
    }
    h += '</table>';
  }

  if (mem.promises?.length) {
    h += '<h3 style="font-size:14px;color:var(--text2);margin:12px 0 8px">Active Promises</h3>';
    for (const p of mem.promises) {
      h += '<div style="padding:6px 0;font-size:13px;border-bottom:1px solid var(--surface2)">';
      h += '<span style="color:' + (p.status === 'active' ? 'var(--green)' : 'var(--text2)') + '">[' + (p.status || 'active') + ']</span> ' + escHtml(p.content);
      h += '</div>';
    }
  }
  document.getElementById('memContent').innerHTML = h;
}

// ── Errors panel ──
function renderErrors(err) {
  let h = '<div class="mem-grid">';
  h += '<div class="mem-card red"><div class="num">' + err.errors + '</div><div class="lbl">Errors (200 lines)</div></div>';
  h += '<div class="mem-card yellow"><div class="num">' + err.warns + '</div><div class="lbl">Warnings</div></div>';
  h += '</div>';
  if (err.recent?.length) {
    h += '<h3 style="font-size:14px;color:var(--text2);margin:12px 0 8px">Recent Errors</h3>';
    for (const e of err.recent) {
      h += '<div class="err-row">[' + e.ts + '] ' + escHtml(e.msg) + '</div>';
    }
  }
  document.getElementById('errContent').innerHTML = h;
}

// ── Routing panel ──
async function refreshRouting() {
  try {
    const rules = await api('/api/routing');
    let html = '';
    for (const [key, val] of Object.entries(rules)) {
      html += '<div class="route-row">';
      html += '<span class="route-key">' + escHtml(key) + '</span>';
      html += '<span class="route-arrow">&rarr;</span>';
      html += '<span class="route-val">' + escHtml(String(val)) + '</span>';
      html += '</div>';
    }
    html += '<div class="routing-editor">';
    html += '<textarea id="routingEditor">' + escHtml(JSON.stringify(rules, null, 2)) + '</textarea>';
    html += '<button class="save-btn" onclick="saveRouting()">Save Routing Rules</button>';
    html += '</div>';
    document.getElementById('routingContent').innerHTML = html;
  } catch (e) { console.error('routing refresh failed', e); }
}

async function saveRouting() {
  const text = document.getElementById('routingEditor').value;
  try {
    const parsed = JSON.parse(text);
    await api('/api/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });
    showToast('Routing rules saved');
    refreshRouting();
  } catch (e) {
    showToast('JSON error: ' + e.message);
  }
}

// ── Consistency panel ──
function renderConsistency(data) {
  const el = document.getElementById('consistencyContent');
  if (!data || !data.ok) {
    const errMsg = data?.error || 'loading...';
    el.innerHTML = '<div class="consistency-status"><span class="icon">&#8987;</span> ' + errMsg + '</div>';
    return;
  }

  const icon = data.healthy ? '&#9989;' : '&#10060;';
  const label = data.healthy ? 'PASS — Fully consistent' : 'MISMATCH — Data inconsistency';
  const labelColor = data.healthy ? 'var(--green)' : 'var(--red)';
  const timeStr = new Date(data.checkedAt).toLocaleTimeString('zh-CN');

  let html = '<div class="consistency-status">';
  html += '<span class="icon">' + icon + '</span>';
  html += '<span style="color:' + labelColor + '">' + label + '</span>';
  html += '<span style="color:var(--text2);font-size:12px;margin-left:auto">chat: ' + (data.chatId || '-').slice(0, 20) + '... | ' + timeStr + '</span>';
  html += '</div>';

  html += '<div class="consistency-detail">';
  html += '<div class="cd-item"><span class="cd-label">DB Total</span><span class="cd-val">' + data.db.total + ' (user:' + data.db.user + ' bot:' + data.db.bot + ')</span></div>';
  html += '<div class="cd-item"><span class="cd-label">Lark API Total</span><span class="cd-val">' + data.lark.total + ' (user:' + data.lark.user + ' bot:' + data.lark.bot + ')</span></div>';
  html += '<div class="cd-item"><span class="cd-label">Matched</span><span class="cd-val" style="color:var(--green)">' + data.matched + ' / ' + data.db.total + '</span></div>';
  html += '<div class="cd-item"><span class="cd-label">Differences</span><span class="cd-val" style="color:' + (data.inDbNotLark.length + data.inLarkNotDb.length > 0 ? 'var(--red)' : 'var(--green)') + '">' + (data.inDbNotLark.length + data.inLarkNotDb.length) + '</span></div>';
  html += '</div>';

  if (data.inDbNotLark.length > 0) {
    html += '<div class="consistency-missing">In DB but not Lark: ' + data.inDbNotLark.join(', ') + '</div>';
  }
  if (data.inLarkNotDb.length > 0) {
    html += '<div class="consistency-missing">In Lark but not DB: ' + data.inLarkNotDb.join(', ') + '</div>';
  }

  el.innerHTML = html;
}

async function refreshConsistency() {
  try {
    const data = await api('/api/consistency');
    renderConsistency(data);
  } catch (e) { console.error('consistency check failed', e); }
}

// ── Refresh bot-specific panels ──
async function refreshPanels() {
  if (!currentBot) return;

  // Pipeline
  if (currentPanel === 'pipeline') {
    try {
      const timings = await api('/api/timings/' + currentBot);
      renderWaterfall(timings);
    } catch {}
  }

  // Memory
  if (currentPanel === 'memory') {
    try {
      const mem = await api('/api/memory/' + currentBot);
      renderMemoryPanel(mem);
    } catch {}
  }

  // Errors
  if (currentPanel === 'errors') {
    try {
      const err = await api('/api/errors/' + currentBot);
      renderErrors(err);
    } catch {}
  }
}

// ── Main refresh (5s) ──
async function refresh() {
  try {
    const [bots, status] = await Promise.all([
      api('/api/pm2'),
      api('/api/status'),
    ]);

    renderBotCards(bots);
    renderChannels(status.channels);

    // If no bot selected from PM2 list, default to gaia-bot
    if (!currentBot && !bots.length) {
      currentBot = 'gaia-bot';
    }

    refreshPanels();

    document.getElementById('refreshNote').textContent =
      'localhost:' + location.port + ' — ' + new Date().toLocaleTimeString('zh-CN');
  } catch (e) { console.error('refresh failed', e); }
}

// ── Initial load ──
refresh();
setInterval(refresh, 5000);
refreshConsistency();
setInterval(refreshConsistency, 60000);

// Load initial logs for selected bot
(async () => {
  await new Promise(r => setTimeout(r, 500)); // wait for first refresh to set currentBot
  if (!currentBot) return;
  try {
    const logs = await api('/api/logs/' + currentBot);
    logLines = logs;
    renderLogs();
  } catch {}
})();
</script>
</body>
</html>`;
}

// ── HTTP server ──────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function jsonResp(res, obj, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function htmlResp(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

ensureDefaults();
startLogWatchers();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // PM2 process list
    if (pathname === '/api/pm2' && method === 'GET') {
      return jsonResp(res, apiPm2());
    }

    // Channel status + memory summary
    if (pathname === '/api/status' && method === 'GET') {
      return jsonResp(res, apiStatus());
    }

    // Channel toggle
    const channelMatch = pathname.match(/^\/api\/channel\/(feishu)\/(on|off)$/);
    if (channelMatch && method === 'POST') {
      return jsonResp(res, apiChannelToggle(channelMatch[1], channelMatch[2]));
    }

    // Detailed memory for a bot
    const memMatch = pathname.match(/^\/api\/memory\/(.+)$/);
    if (memMatch && method === 'GET') {
      return jsonResp(res, apiMemoryBot(memMatch[1]));
    }

    // Pipeline timings
    const timMatch = pathname.match(/^\/api\/timings\/(.+)$/);
    if (timMatch && method === 'GET') {
      return jsonResp(res, apiTimings(timMatch[1]));
    }

    // Error aggregation
    const errMatch = pathname.match(/^\/api\/errors\/(.+)$/);
    if (errMatch && method === 'GET') {
      return jsonResp(res, apiErrors(errMatch[1]));
    }

    // SSE live log stream (must match before log snapshot)
    const sseMatch = pathname.match(/^\/api\/logs\/([^/]+)\/stream$/);
    if (sseMatch && method === 'GET') {
      const botName = sseMatch[1];
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(':ok\n\n');
      const clients = sseClients.get(botName);
      if (clients) {
        clients.add(res);
        req.on('close', () => clients.delete(res));
      }
      return;
    }

    // Log snapshot
    const logMatch = pathname.match(/^\/api\/logs\/([^/]+)$/);
    if (logMatch && method === 'GET') {
      return jsonResp(res, apiLogs(logMatch[1]));
    }

    // Routing
    if (pathname === '/api/routing' && method === 'GET') {
      return jsonResp(res, apiRouting());
    }
    if (pathname === '/api/routing' && method === 'POST') {
      const body = await readBody(req);
      return jsonResp(res, apiUpdateRouting(body));
    }

    // Consistency
    if (pathname === '/api/consistency' && method === 'GET') {
      const force = url.searchParams.get('force') === '1';
      return jsonResp(res, apiConsistency(force));
    }

    // HTML page
    if (pathname === '/' || pathname === '/index.html') {
      return htmlResp(res, getHtmlPage());
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Request error:', err);
    jsonResp(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Gaia Dashboard running at http://localhost:${PORT}\n`);
});
