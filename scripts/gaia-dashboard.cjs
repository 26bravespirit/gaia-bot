#!/usr/bin/env node
/**
 * gaia-dashboard -- Gaia 双通道 Web 仪表盘
 *
 * 单文件 HTTP 服务器, 端口 3456, 内联 HTML/CSS/JS, 零外部依赖.
 *
 * API:
 *   GET  /api/status              两通道状态 + 进程 + 记忆概览
 *   POST /api/channel/:name/on    启用通道
 *   POST /api/channel/:name/off   停用通道
 *   GET  /api/memory              记忆系统详情
 *   GET  /api/routing             路由规则
 *   POST /api/routing             更新路由规则 (JSON body)
 *   GET  /api/consistency          消息一致性检查 (DB vs Lark API, 最近100条)
 *   GET  /                        仪表盘页面
 */

const http = require('http');
const Database = require('better-sqlite3');
const { execSync, execFileSync } = require('child_process');
const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3456;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(PROJECT_ROOT, 'data/persona.db');

// ── channel metadata ──────────────────────────────────────────────────
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

// ── helpers ────────────────────────────────────────────────────────────

function openDb(readonly = false) {
  return new Database(DB_PATH, { readonly });
}

function ensureDefaults() {
  const db = openDb(false);
  const upsert = db.prepare(
    `INSERT OR IGNORE INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?)`
  );
  const now = Date.now();
  upsert.run('channel_feishu_enabled', 'true', now);
  upsert.run(
    'routing_rules',
    JSON.stringify({ default: 'feishu' }),
    now
  );
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

// ── API handlers ──────────────────────────────────────────────────────

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

  // memory summary
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

function apiMemory() {
  const db = openDb(true);
  const result = {};

  try {
    result.ltmCount = db.prepare('SELECT COUNT(*) as c FROM long_term_memories').get().c;
    result.recentLtm = db.prepare(
      'SELECT type, content, importance, keywords, created_at FROM long_term_memories ORDER BY created_at DESC LIMIT 10'
    ).all();
  } catch (_) {}

  try {
    result.bioCount = db.prepare('SELECT COUNT(*) as c FROM biographical_facts WHERE is_active=1').get().c;
    result.recentBio = db.prepare(
      "SELECT period, fact_content, importance, confidence, source_type FROM biographical_facts WHERE is_active=1 ORDER BY id DESC LIMIT 10"
    ).all();
  } catch (_) {}

  try {
    result.relationships = db.prepare('SELECT * FROM relationships').all();
  } catch (_) {}

  try {
    result.selfState = db.prepare('SELECT * FROM self_state WHERE id=1').get();
  } catch (_) {}

  try {
    result.eventCount = db.prepare('SELECT COUNT(*) as c FROM event_log').get().c;
  } catch (_) {}

  db.close();
  return result;
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

// ── Consistency check ─────────────────────────────────────────────────

const LARK_CLI_BIN = process.env.LARK_CLI_BIN || '/opt/homebrew/bin/lark-cli';
const CONSISTENCY_LARK_HOME = process.env.LARK_HOME || process.env.HOME;
const CONSISTENCY_CHAT_IDS = (process.env.TARGET_CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const CONSISTENCY_INTERVAL_MS = 60_000; // 60s between scans
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

  // Find the most active chat if no TARGET_CHAT_ID
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
  const results = [];

  // Get last N messages from DB
  const dbRows = db.prepare(
    'SELECT message_id, role, substr(content, 1, 60) as content, timestamp FROM conversation_log WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(chatId, CONSISTENCY_MSG_COUNT);
  db.close();

  const dbIds = new Set(dbRows.map(r => r.message_id));
  const dbCount = dbRows.length;

  // Get messages from Lark API (up to 2 pages of 50)
  const larkResult = larkCliListMessages(chatId, 50);
  if (!larkResult.ok) {
    consistencyCache = { ok: false, error: larkResult.error?.message || 'lark_api_failed', chatId, checkedAt: now };
    consistencyLastRun = now;
    return consistencyCache;
  }

  let larkMessages = larkResult.data?.messages || [];

  // Fetch page 2 if needed
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

  // Compare
  const inDbNotLark = [...dbIds].filter(id => !larkIds.has(id));
  const inLarkNotDb = [...larkIds].filter(id => !dbIds.has(id));
  const matched = [...dbIds].filter(id => larkIds.has(id)).length;

  // Role distribution
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

// ── HTML page ─────────────────────────────────────────────────────────

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
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 4px;
    letter-spacing: -0.5px;
  }
  .subtitle {
    color: var(--text2);
    font-size: 13px;
    margin-bottom: 24px;
  }
  .subtitle .dot {
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
  .subtitle .dot.live { background: var(--green); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .card-title {
    font-size: 15px;
    font-weight: 600;
  }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }
  .badge.on  { background: rgba(52,211,153,0.15); color: var(--green); }
  .badge.off { background: rgba(248,113,113,0.15); color: var(--red); }

  .info-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .info-row:last-child { border-bottom: none; }
  .info-label { color: var(--text2); }
  .info-value { font-family: "SF Mono", Menlo, monospace; font-size: 12px; }

  .status-dot {
    display: inline-block;
    width: 8px; height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
  }
  .status-dot.on  { background: var(--green); }
  .status-dot.off { background: var(--red); }
  .status-dot.idle { background: var(--text2); }

  .toggle-btn {
    display: inline-block;
    padding: 6px 20px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 12px;
    margin-right: 8px;
  }
  .toggle-btn.enable  { background: rgba(52,211,153,0.15); color: var(--green); }
  .toggle-btn.disable { background: rgba(248,113,113,0.15); color: var(--red); }
  .toggle-btn:hover { filter: brightness(1.2); transform: translateY(-1px); }
  .toggle-btn:active { transform: translateY(0); }

  .section-title {
    font-size: 16px;
    font-weight: 600;
    margin: 24px 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .memory-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .mem-card {
    background: var(--surface2);
    border-radius: 10px;
    padding: 16px;
    text-align: center;
  }
  .mem-card .num {
    font-size: 28px;
    font-weight: 700;
    font-family: "SF Mono", Menlo, monospace;
  }
  .mem-card .label { color: var(--text2); font-size: 12px; margin-top: 4px; }
  .mem-card.green .num { color: var(--green); }
  .mem-card.blue  .num { color: var(--blue); }
  .mem-card.purple .num { color: var(--purple); }
  .mem-card.yellow .num { color: var(--yellow); }

  .routing-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
  }
  .route-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .route-row:last-child { border-bottom: none; }
  .route-key {
    font-family: "SF Mono", Menlo, monospace;
    font-size: 12px;
    background: var(--surface2);
    padding: 3px 8px;
    border-radius: 4px;
    min-width: 140px;
  }
  .route-arrow { color: var(--text2); }
  .route-val {
    font-weight: 500;
  }

  .routing-editor {
    margin-top: 12px;
  }
  .routing-editor textarea {
    width: 100%;
    height: 80px;
    background: var(--surface2);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    font-family: "SF Mono", Menlo, monospace;
    font-size: 12px;
    resize: vertical;
  }
  .routing-editor textarea:focus { outline: none; border-color: var(--blue); }

  .save-btn {
    display: inline-block;
    padding: 6px 20px;
    background: rgba(96,165,250,0.15);
    color: var(--blue);
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    margin-top: 8px;
    transition: all 0.2s;
  }
  .save-btn:hover { filter: brightness(1.2); }

  .toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--surface2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 20px;
    border-radius: 10px;
    font-size: 13px;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s;
    pointer-events: none;
    z-index: 999;
  }
  .toast.show { opacity: 1; transform: translateY(0); }

  .consistency-status {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0;
    font-size: 14px;
    font-weight: 500;
  }
  .consistency-status .icon { font-size: 20px; }
  .consistency-detail {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 8px;
  }
  .consistency-detail .cd-item {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }
  .consistency-detail .cd-label { color: var(--text2); }
  .consistency-detail .cd-val { font-family: "SF Mono", Menlo, monospace; font-size: 12px; }
  .consistency-missing {
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(248,113,113,0.1);
    border-radius: 8px;
    font-size: 12px;
    color: var(--red);
    font-family: "SF Mono", Menlo, monospace;
    word-break: break-all;
  }

  .refresh-note {
    color: var(--text2);
    font-size: 11px;
    text-align: right;
    margin-top: 16px;
  }
</style>
</head>
<body>

<h1>Gaia Dashboard</h1>
<div class="subtitle"><span class="dot live"></span>管理面板 &mdash; 每 5 秒自动刷新</div>

<div class="grid" id="channels"></div>

<div class="section-title">记忆系统</div>
<div class="memory-grid" id="memory"></div>

<div class="section-title">路由规则</div>
<div class="routing-card" id="routing"></div>

<div class="section-title">消息一致性检查 <span style="font-size:12px;color:var(--text2)">(DB vs Lark API, 最近100条, 每60秒)</span></div>
<div class="routing-card" id="consistency"></div>

<div class="refresh-note" id="refreshNote"></div>
<div class="toast" id="toast"></div>

<script>
const API = '';

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

async function api(path, opts) {
  const res = await fetch(API + path, opts);
  return res.json();
}

async function toggleChannel(name, action) {
  await api('/api/channel/' + name + '/' + action, { method: 'POST' });
  showToast((action === 'on' ? '已启用' : '已停用') + ' ' + name);
  refresh();
}

function renderChannels(channels) {
  const el = document.getElementById('channels');
  let html = '';
  for (const [name, ch] of Object.entries(channels)) {
    const onClass = ch.enabled ? 'on' : 'off';
    const onText = ch.enabled ? 'ON' : 'OFF';
    const procDot = ch.process.running ? 'on' : 'idle';
    const procText = ch.process.running ? '运行中 (PID ' + ch.process.pid + ')' : '未运行';
    const subDot = ch.subscribe.active ? 'on' : 'idle';
    const subText = ch.subscribe.active ? '活跃 (PID ' + ch.subscribe.pid + ')' : '无';

    html += '<div class="card">';
    html += '<div class="card-header">';
    html += '<span class="card-title">' + ch.label + '</span>';
    html += '<span class="badge ' + onClass + '">' + onText + '</span>';
    html += '</div>';

    html += '<div class="info-row"><span class="info-label">通道</span><span class="info-value">' + name + '</span></div>';
    html += '<div class="info-row"><span class="info-label">进程</span><span class="info-value"><span class="status-dot ' + procDot + '"></span>' + procText + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Subscribe</span><span class="info-value"><span class="status-dot ' + subDot + '"></span>' + subText + '</span></div>';
    html += '<div class="info-row"><span class="info-label">AppID</span><span class="info-value">' + ch.appId + '</span></div>';
    html += '<div class="info-row"><span class="info-label">Brand</span><span class="info-value">' + ch.brand + '</span></div>';

    if (ch.enabled) {
      html += '<button class="toggle-btn disable" onclick="toggleChannel(\\''+name+'\\',\\'off\\')">停用</button>';
    } else {
      html += '<button class="toggle-btn enable" onclick="toggleChannel(\\''+name+'\\',\\'on\\')">启用</button>';
    }
    html += '</div>';
  }
  el.innerHTML = html;
}

function renderMemory(mem) {
  const el = document.getElementById('memory');
  let html = '';
  html += '<div class="mem-card green"><div class="num">' + (mem.ltmCount || 0) + '</div><div class="label">长期记忆</div></div>';
  html += '<div class="mem-card blue"><div class="num">' + (mem.bioCount || 0) + '</div><div class="label">传记事实</div></div>';

  if (mem.relationship) {
    html += '<div class="mem-card purple"><div class="num">' + (mem.relationship.interaction_count || 0) + '</div><div class="label">互动次数</div></div>';
    html += '<div class="mem-card yellow"><div class="num">' + (typeof mem.relationship.intimacy_score === 'number' ? mem.relationship.intimacy_score.toFixed(2) : '0') + '</div><div class="label">亲密度</div></div>';
  }
  if (mem.selfState) {
    html += '<div class="mem-card"><div class="num" style="font-size:16px">' + (mem.selfState.mood_baseline || '-') + '</div><div class="label">心情基线</div></div>';
    html += '<div class="mem-card"><div class="num" style="font-size:16px">' + (mem.selfState.energy_level || '-') + '</div><div class="label">能量等级</div></div>';
  }

  el.innerHTML = html;
}

let currentRouting = {};

function renderRouting(rules) {
  currentRouting = rules;
  const el = document.getElementById('routing');
  let html = '';

  for (const [key, val] of Object.entries(rules)) {
    html += '<div class="route-row">';
    html += '<span class="route-key">' + key + '</span>';
    html += '<span class="route-arrow">&rarr;</span>';
    html += '<span class="route-val">' + val + '</span>';
    html += '</div>';
  }

  html += '<div class="routing-editor">';
  html += '<textarea id="routingEditor">' + JSON.stringify(rules, null, 2) + '</textarea>';
  html += '<button class="save-btn" onclick="saveRouting()">保存路由规则</button>';
  html += '</div>';

  el.innerHTML = html;
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
    showToast('路由规则已保存');
    refresh();
  } catch (e) {
    showToast('JSON 格式错误: ' + e.message);
  }
}

async function refresh() {
  try {
    const status = await api('/api/status');
    renderChannels(status.channels);
    renderMemory(status.memory);

    const routing = await api('/api/routing');
    renderRouting(routing);

    document.getElementById('refreshNote').textContent =
      '上次刷新: ' + new Date().toLocaleTimeString('zh-CN');
  } catch (e) {
    console.error('refresh failed', e);
  }
}

function renderConsistency(data) {
  const el = document.getElementById('consistency');
  if (!data || !data.ok) {
    const errMsg = data?.error || 'loading...';
    el.innerHTML = '<div class="consistency-status"><span class="icon">&#8987;</span> ' + errMsg + '</div>';
    return;
  }

  const icon = data.healthy ? '&#9989;' : '&#10060;';
  const label = data.healthy ? 'PASS — 完全一致' : 'MISMATCH — 数据不一致';
  const labelColor = data.healthy ? 'var(--green)' : 'var(--red)';
  const timeStr = new Date(data.checkedAt).toLocaleTimeString('zh-CN');

  let html = '<div class="consistency-status">';
  html += '<span class="icon">' + icon + '</span>';
  html += '<span style="color:' + labelColor + '">' + label + '</span>';
  html += '<span style="color:var(--text2);font-size:12px;margin-left:auto">chat: ' + (data.chatId || '-').slice(0, 20) + '... | ' + timeStr + '</span>';
  html += '</div>';

  html += '<div class="consistency-detail">';
  html += '<div class="cd-item"><span class="cd-label">DB 总数</span><span class="cd-val">' + data.db.total + ' (user:' + data.db.user + ' bot:' + data.db.bot + ')</span></div>';
  html += '<div class="cd-item"><span class="cd-label">Lark API 总数</span><span class="cd-val">' + data.lark.total + ' (user:' + data.lark.user + ' bot:' + data.lark.bot + ')</span></div>';
  html += '<div class="cd-item"><span class="cd-label">匹配数</span><span class="cd-val" style="color:var(--green)">' + data.matched + ' / ' + data.db.total + '</span></div>';
  html += '<div class="cd-item"><span class="cd-label">差异数</span><span class="cd-val" style="color:' + (data.inDbNotLark.length + data.inLarkNotDb.length > 0 ? 'var(--red)' : 'var(--green)') + '">' + (data.inDbNotLark.length + data.inLarkNotDb.length) + '</span></div>';
  html += '</div>';

  if (data.inDbNotLark.length > 0) {
    html += '<div class="consistency-missing">DB 有但 Lark 无: ' + data.inDbNotLark.join(', ') + '</div>';
  }
  if (data.inLarkNotDb.length > 0) {
    html += '<div class="consistency-missing">Lark 有但 DB 无: ' + data.inLarkNotDb.join(', ') + '</div>';
  }

  el.innerHTML = html;
}

async function refreshConsistency() {
  try {
    const data = await api('/api/consistency');
    renderConsistency(data);
  } catch (e) {
    console.error('consistency check failed', e);
  }
}

refresh();
setInterval(refresh, 5000);
refreshConsistency();
setInterval(refreshConsistency, 60000);
</script>
</body>
</html>`;
}

// ── HTTP server ───────────────────────────────────────────────────────

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

function json(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

ensureDefaults();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method;

  try {
    // API routes
    if (pathname === '/api/status' && method === 'GET') {
      return json(res, apiStatus());
    }

    const channelMatch = pathname.match(/^\/api\/channel\/(feishu)\/(on|off)$/);
    if (channelMatch && method === 'POST') {
      return json(res, apiChannelToggle(channelMatch[1], channelMatch[2]));
    }

    if (pathname === '/api/memory' && method === 'GET') {
      return json(res, apiMemory());
    }

    if (pathname === '/api/routing' && method === 'GET') {
      return json(res, apiRouting());
    }

    if (pathname === '/api/routing' && method === 'POST') {
      const body = await readBody(req);
      return json(res, apiUpdateRouting(body));
    }

    if (pathname === '/api/consistency' && method === 'GET') {
      const force = url.searchParams.get('force') === '1';
      return json(res, apiConsistency(force));
    }

    // HTML page
    if (pathname === '/' || pathname === '/index.html') {
      return html(res, getHtmlPage());
    }

    // 404
    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Request error:', err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  Gaia Dashboard 已启动`);
  console.log(`  http://localhost:${PORT}\n`);
});
