#!/usr/bin/env node
/**
 * Gaia Control Center v2 — Unified dashboard for all bots
 * Port: 3400
 *
 * Features:
 *   - PM2 process monitoring (auto-discover bots)
 *   - Pipeline timing waterfall
 *   - Live log stream (SSE)
 *   - Memory & relationship overview
 *   - Error aggregation
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');

const PORT = 3400;
const PM2_BIN = (() => {
  try { return execSync('which pm2', { encoding: 'utf-8' }).trim(); } catch {}
  try { return execSync('which npx', { encoding: 'utf-8' }).trim() + ' pm2'; } catch {}
  return 'npx pm2';
})();
const PLIST_PATH = path.join(os.homedir(), 'Library/LaunchAgents/com.gaia.pm2.plist');

// Bot DB paths (auto-discovered from PM2 cwd)
const BOT_CONFIGS = {
  'gaia-bot': {
    db: path.resolve(__dirname, '../data/persona.db'),
    log: path.resolve(__dirname, '../logs/persona-bot.log'),
    ecosystem: path.resolve(__dirname, '../ecosystem.config.cjs'),
    scheduleKey: 'schedule_shutdown',
  },
  'persona-bot': {
    db: process.env.PERSONA_BOT_DB || path.join(process.env.HOME, '本地文档/claude code/对话服务/persona-bot/data/persona.db'),
    log: process.env.PERSONA_BOT_LOG || path.join(process.env.HOME, '本地文档/claude code/对话服务/persona-bot/logs/persona-bot.log'),
    ecosystem: process.env.PERSONA_BOT_ECOSYSTEM || path.join(process.env.HOME, '本地文档/claude code/对话服务/persona-bot/ecosystem.config.cjs'),
    scheduleKey: 'schedule_shutdown',
  },
};

let Database;
try { Database = require('better-sqlite3'); } catch { Database = null; }

// ── .env read/write helpers ──

const ENV_PATH = path.resolve(__dirname, '../.env');

function readEnvValue(key) {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf-8');
    const match = content.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return match ? match[1].trim() : '';
  } catch { return ''; }
}

function writeEnvValue(key, value) {
  try {
    let content = fs.readFileSync(ENV_PATH, 'utf-8');
    const regex = new RegExp('^' + key + '=.*$', 'm');
    if (regex.test(content)) {
      content = content.replace(regex, key + '=' + value);
    } else {
      content += '\n' + key + '=' + value;
    }
    fs.writeFileSync(ENV_PATH, content, 'utf-8');
    return true;
  } catch { return false; }
}

function maskKey(key) {
  if (!key || key.length < 8) return key ? '••••' : '';
  return key.slice(0, 4) + '••••••' + key.slice(-3);
}

// ── Helpers ──

function getPm2List() {
  try {
    return JSON.parse(execSync('npx pm2 jlist 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }));
  } catch { return []; }
}

function queryDb(dbPath, sql, params = []) {
  if (!Database || !fs.existsSync(dbPath)) return [];
  try {
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare(sql).all(...params);
    db.close();
    return rows;
  } catch { return []; }
}

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

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

// ── API handlers ──

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

// ── Process control (PM2 wrappers) ────────────────────────────────────

function pm2Exec(args) {
  try {
    const cmd = `${PM2_BIN} ${args}`;
    execSync(cmd, { encoding: 'utf-8', timeout: 15000,
      env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

function apiStart(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return { ok: false, error: 'unknown bot' };
  if (!fs.existsSync(cfg.ecosystem)) return { ok: false, error: 'ecosystem config not found: ' + cfg.ecosystem };
  // pm2 start will no-op if already online; use --only to target specific app
  return pm2Exec(`start "${cfg.ecosystem}" --only ${botName}`);
}

function apiStop(botName) {
  if (!BOT_CONFIGS[botName]) return { ok: false, error: 'unknown bot' };
  return pm2Exec(`stop ${botName}`);
}

function apiRestart(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg) return { ok: false, error: 'unknown bot' };
  // If not in PM2 yet, start it first
  const list = getPm2List();
  const exists = list.some(p => p.name === botName);
  if (!exists) return apiStart(botName);
  return pm2Exec(`restart ${botName}`);
}

function apiDelete(botName) {
  if (!BOT_CONFIGS[botName]) return { ok: false, error: 'unknown bot' };
  return pm2Exec(`delete ${botName}`);
}

// ── Autostart (user-level launchd) ───────────────────────────────────

function buildPlist() {
  const nodeBin = process.execPath;
  const pm2Main = (() => {
    try { return execSync('node -e "console.log(require.resolve(\'pm2/bin/pm2\'))"', { encoding: 'utf-8' }).trim(); }
    catch { return '/opt/homebrew/lib/node_modules/pm2/bin/pm2'; }
  })();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.gaia.pm2</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeBin}</string>
    <string>${pm2Main}</string>
    <string>resurrect</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), '.pm2/logs/resurrect.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), '.pm2/logs/resurrect-err.log')}</string>
</dict>
</plist>`;
}

function apiAutostartStatus() {
  const exists = fs.existsSync(PLIST_PATH);
  let loaded = false;
  if (exists) {
    try {
      const out = execSync('launchctl list 2>/dev/null', { encoding: 'utf-8', timeout: 3000 });
      loaded = out.includes('com.gaia.pm2');
    } catch {}
  }
  return { enabled: exists && loaded, plistExists: exists, loaded };
}

function apiAutostartEnable() {
  try {
    // Save current PM2 process list first
    pm2Exec('save --force');
    // Write plist
    fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
    fs.writeFileSync(PLIST_PATH, buildPlist(), 'utf-8');
    // Unload first (ignore error if not loaded)
    try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { timeout: 5000 }); } catch {}
    execSync(`launchctl load "${PLIST_PATH}"`, { encoding: 'utf-8', timeout: 5000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
}

function apiAutostartDisable() {
  try {
    if (fs.existsSync(PLIST_PATH)) {
      try { execSync(`launchctl unload "${PLIST_PATH}" 2>/dev/null`, { timeout: 5000 }); } catch {}
      fs.unlinkSync(PLIST_PATH);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
}

// ── Schedule shutdown ─────────────────────────────────────────────────

// In-memory timers: botName -> { type, timer }
const scheduleTimers = {};

function getScheduleDb(botName) {
  const cfg = BOT_CONFIGS[botName];
  if (!cfg || !Database || !fs.existsSync(cfg.db)) return null;
  try { return new Database(cfg.db); } catch { return null; }
}

function readSchedule(botName) {
  const db = getScheduleDb(botName);
  if (!db) return { type: 'none' };
  try {
    const row = db.prepare('SELECT value FROM runtime_config WHERE key = ?').get(BOT_CONFIGS[botName].scheduleKey);
    db.close();
    return row ? JSON.parse(row.value) : { type: 'none' };
  } catch { db.close(); return { type: 'none' }; }
}

function writeSchedule(botName, sched) {
  const db = getScheduleDb(botName);
  if (!db) return false;
  try {
    db.prepare(`INSERT INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(BOT_CONFIGS[botName].scheduleKey, JSON.stringify(sched), Date.now());
    db.close();
    return true;
  } catch { db.close(); return false; }
}

function clearScheduleTimer(botName) {
  const existing = scheduleTimers[botName];
  if (existing?.timer) clearTimeout(existing.timer);
  delete scheduleTimers[botName];
}

function applySchedule(botName, sched) {
  clearScheduleTimer(botName);
  if (sched.type === 'none') return;

  const fireStop = () => {
    console.log(`[schedule] stopping ${botName} by schedule (type=${sched.type})`);
    pm2Exec(`stop ${botName}`);
    // Reset to none after firing
    writeSchedule(botName, { type: 'none' });
    delete scheduleTimers[botName];
  };

  if (sched.type === 'delay') {
    const ms = sched.until - Date.now();
    if (ms <= 0) return fireStop();
    scheduleTimers[botName] = { type: 'delay', timer: setTimeout(fireStop, ms) };
    return;
  }

  if (sched.type === 'daily') {
    // Check every minute
    const checkDaily = () => {
      const now = new Date();
      const [hh, mm] = (sched.time || '22:00').split(':').map(Number);
      if (now.getHours() === hh && now.getMinutes() === mm) return fireStop();
      // Re-arm for next minute; don't reset type so it repeats daily
    };
    const dailyInterval = setInterval(checkDaily, 60_000);
    scheduleTimers[botName] = { type: 'daily', timer: dailyInterval };
  }
}

function loadAllSchedules() {
  for (const name of Object.keys(BOT_CONFIGS)) {
    try {
      const sched = readSchedule(name);
      if (sched.type !== 'none') applySchedule(name, sched);
    } catch {}
  }
}

function apiGetSchedule(botName) {
  if (!BOT_CONFIGS[botName]) return { type: 'none' };
  return readSchedule(botName);
}

function apiSetSchedule(botName, sched) {
  if (!BOT_CONFIGS[botName]) return { ok: false, error: 'unknown bot' };
  const ok = writeSchedule(botName, sched);
  if (ok) applySchedule(botName, sched);
  return { ok };
}

function apiMemory(botName) {
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

// ── SSE Log Stream ──

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
          const data = m ? JSON.stringify({ ts: m[1], level: m[2], msg: m[3] }) : JSON.stringify({ ts: '', level: 'info', msg: line });
          for (const client of clients) {
            client.write(`data: ${data}\n\n`);
          }
        }
      });
    });
  }
}

// ── HTML ──

function getPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gaia Control Center</title>
<style>
/* ── Picasso Palette ──
   Blue Period: deep cerulean, slate blue
   Rose Period: terracotta, warm sand
   Cubist: ochre, olive, charcoal geometry
   Canvas: warm linen ground
*/
:root{
  --canvas:#e8dfd4;--card:#f5f1eb;--border:#d4cabb;--border-light:#e4ddd2;
  --ink:#1e1e1e;--ink-sub:#5c5550;--ink-muted:#9b918a;
  --blue:#2d5f8a;--rose:#c06b4e;--ochre:#c49a3f;--olive:#6a7d5a;--slate:#5e6e82;--terra:#a14b35;
  --mono:'SF Mono','Menlo',monospace;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Georgia','Hiragino Mincho ProN','Noto Serif SC',serif;color:var(--ink);min-height:100vh;padding:32px;background:var(--canvas);background-image:url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='g'%3E%3CfeTurbulence baseFrequency='0.8' numOctaves='4' type='fractalNoise' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23g)' opacity='0.04'/%3E%3C/svg%3E")}
.container{max-width:1100px;margin:0 auto}
h1{font-size:18px;font-weight:400;color:var(--ink);margin-bottom:4px;letter-spacing:1px;font-style:italic}
.sub{color:var(--ink-muted);font-size:11px;margin-bottom:32px;font-family:-apple-system,sans-serif}
.sub .dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:var(--olive);margin-right:6px}

/* Bot cards */
.bots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:32px}
.bot-card{background:var(--card);border:1px solid var(--border);border-radius:4px;padding:24px}
.bot-card h2{font-size:14px;font-weight:400;margin-bottom:16px;display:flex;align-items:center;gap:10px;color:var(--ink);font-family:-apple-system,sans-serif}
.badge{padding:2px 8px;border-radius:2px;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;font-family:-apple-system,sans-serif}
.badge.on{background:rgba(106,125,90,.12);color:var(--olive);border:1px solid var(--olive)}
.badge.off{background:rgba(161,75,53,.08);color:var(--terra);border:1px solid var(--terra)}
.row{display:flex;justify-content:space-between;padding:6px 0;font-size:12px;border-bottom:1px solid var(--border-light);font-family:-apple-system,sans-serif}
.row:last-child{border:none}
.row .k{color:var(--ink-muted)}
.row .v{font-family:var(--mono);font-size:11px;color:var(--ink)}

/* Tabs */
.tabs{display:flex;gap:0;margin-bottom:20px;border-bottom:2px solid var(--ink);padding-bottom:0}
.tab{padding:8px 20px;font-size:12px;cursor:pointer;color:var(--ink-muted);background:transparent;border:none;border-bottom:2px solid transparent;transition:all .2s;margin-bottom:-2px;font-family:-apple-system,sans-serif;letter-spacing:.3px}
.tab:hover{color:var(--ink-sub)}
.tab.active{color:var(--ink);border-bottom-color:var(--blue)}
.tab-select{display:flex;gap:4px;margin-bottom:12px}
.tab-select button{padding:4px 12px;border-radius:2px;font-size:11px;cursor:pointer;color:var(--ink-sub);background:transparent;border:1px solid var(--border);font-family:-apple-system,sans-serif}
.tab-select button.active{background:var(--border-light);color:var(--ink)}

/* Panels */
.panel{display:none;background:var(--card);border:1px solid var(--border);border-radius:4px;padding:24px;margin-bottom:20px}
.panel.active{display:block}

/* Memory cards */
.mem-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px}
.mem-card{background:var(--canvas);border:1px solid var(--border);border-radius:4px;padding:12px;text-align:center}
.mem-card .num{font-size:20px;font-weight:400;font-family:var(--mono)}
.mem-card .lbl{color:var(--ink-muted);font-size:10px;margin-top:4px;letter-spacing:.3px;font-family:-apple-system,sans-serif}
.green .num{color:var(--olive)}.blue .num{color:var(--blue)}.purple .num{color:var(--slate)}.yellow .num{color:var(--ochre)}.red .num{color:var(--terra)}

/* Users table */
table{width:100%;font-size:12px;border-collapse:collapse;font-family:-apple-system,sans-serif}
th{text-align:left;color:var(--ink-muted);font-weight:400;padding:8px;border-bottom:2px solid var(--ink);font-size:10px;letter-spacing:.5px;text-transform:uppercase}
td{padding:8px;border-bottom:1px solid var(--border-light);color:var(--ink)}

/* Waterfall — Picasso palette */
.wf-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:11px;border-bottom:1px solid var(--border-light);font-family:-apple-system,sans-serif}
.wf-sender{width:80px;color:var(--ink-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-bars{flex:1;display:flex;height:16px;border-radius:2px;overflow:hidden}
.wf-bar{height:100%;min-width:2px;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;overflow:hidden}
.wf-total{width:50px;text-align:right;font-family:var(--mono);font-size:10px;color:var(--ink-muted)}
.wf-bar.s1{background:var(--blue)}.wf-bar.s2{background:var(--slate)}.wf-bar.s3s4{background:var(--ochre)}.wf-bar.s5{background:var(--olive)}.wf-bar.s55{background:var(--rose)}.wf-bar.s6{background:var(--terra)}
.wf-legend{display:flex;gap:16px;font-size:10px;color:var(--ink-muted);margin-bottom:10px;letter-spacing:.2px;font-family:-apple-system,sans-serif}
.wf-legend span{display:flex;align-items:center;gap:4px}
.wf-legend i{width:8px;height:8px;border-radius:1px;display:inline-block}

/* Logs */
.log-box{background:var(--canvas);border:1px solid var(--border);border-radius:4px;padding:16px;max-height:360px;overflow-y:auto;font-family:var(--mono);font-size:11px;line-height:1.8;color:var(--ink)}
.log-line{white-space:pre-wrap;word-break:break-all}
.log-line .ts{color:var(--ink-muted)}.log-line .info{color:var(--blue)}.log-line .warn{color:var(--ochre)}.log-line .error{color:var(--terra)}
.log-filters{display:flex;gap:8px;margin-bottom:10px;font-family:-apple-system,sans-serif}
.log-filters label{font-size:10px;color:var(--ink-sub);display:flex;align-items:center;gap:4px;cursor:pointer}
.log-filters input{accent-color:var(--blue)}

/* Errors */
.err-row{padding:10px;background:rgba(161,75,53,.06);border:1px solid rgba(161,75,53,.2);border-radius:2px;margin-bottom:8px;font-size:11px;font-family:var(--mono);color:var(--terra)}

.footer{text-align:center;color:var(--border);font-size:10px;margin-top:40px;letter-spacing:1px;font-family:-apple-system,sans-serif}

/* Control buttons */
.ctrl-row{display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap}
.ctrl-btn{display:flex;align-items:center;gap:5px;padding:6px 16px;border:1px solid var(--border);border-radius:3px;font-size:11px;font-weight:400;cursor:pointer;transition:all .15s;font-family:-apple-system,sans-serif;background:transparent;color:var(--ink)}
.ctrl-btn:disabled{opacity:.25;cursor:not-allowed}
.ctrl-btn:not(:disabled):hover{background:var(--border-light)}
.ctrl-btn:not(:disabled):active{background:var(--border)}
.ctrl-btn.start{color:var(--olive);border-color:var(--olive)}
.ctrl-btn.stop{color:var(--terra);border-color:var(--terra)}
.ctrl-btn.restart{color:var(--blue);border-color:var(--blue)}
.ctrl-btn.loading{opacity:.5;cursor:wait}

/* Advanced panel */
.adv-toggle{display:flex;align-items:center;gap:6px;margin-top:14px;color:var(--ink-muted);font-size:11px;cursor:pointer;user-select:none;background:none;border:none;font-family:-apple-system,sans-serif;padding:0;letter-spacing:.2px}
.adv-toggle:hover{color:var(--ink-sub)}
.adv-panel{display:none;margin-top:14px;border-top:1px solid var(--border);padding-top:14px}
.adv-panel.open{display:block}

/* Toggle switch */
.sw-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border-light);font-family:-apple-system,sans-serif}
.sw-row:last-child{border:none}
.sw-label{font-size:12px;color:var(--ink)}
.sw-sub{font-size:10px;color:var(--ink-muted);margin-top:3px}
.switch{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
.switch input{opacity:0;width:0;height:0}
.slider{position:absolute;inset:0;background:var(--border);border-radius:20px;transition:.2s;cursor:pointer}
.slider:before{content:'';position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
input:checked+.slider{background:var(--blue)}
input:checked+.slider:before{background:#fff;transform:translateX(16px)}

/* Schedule */
.sched-options{display:flex;flex-direction:column;gap:8px;margin-top:10px;font-family:-apple-system,sans-serif}
.sched-opt{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink);cursor:pointer}
.sched-opt input[type=radio]{accent-color:var(--blue)}
.sched-input{background:var(--canvas);border:1px solid var(--border);border-radius:3px;color:var(--ink);padding:4px 8px;font-size:11px;font-family:var(--mono);width:90px}
.sched-input:focus{outline:none;border-color:var(--blue)}
.sched-save{margin-top:12px;padding:6px 20px;background:var(--blue);color:#fff;border:none;border-radius:3px;font-size:11px;font-weight:500;cursor:pointer;font-family:-apple-system,sans-serif;transition:opacity .15s;letter-spacing:.3px}
.sched-save:hover{opacity:.85}

/* Toast */
.toast{position:fixed;bottom:32px;right:32px;background:var(--ink);color:var(--canvas);padding:12px 20px;border-radius:4px;font-size:12px;opacity:0;transform:translateY(8px);transition:all .25s;pointer-events:none;z-index:999;font-family:-apple-system,sans-serif}
/* OpenAI config */
.oai-row{display:flex;align-items:center;gap:8px;font-family:-apple-system,sans-serif}
.oai-label{font-size:12px;color:var(--ink-sub);width:52px;flex-shrink:0}
.oai-input{flex:1;background:var(--canvas);border:1px solid var(--border);border-radius:3px;color:var(--ink);padding:5px 8px;font-size:11px;font-family:var(--mono)}
.oai-input::placeholder{color:var(--ink-muted)}
.oai-select{flex:1;background:var(--canvas);border:1px solid var(--border);border-radius:3px;color:var(--ink);padding:5px 8px;font-size:11px;font-family:var(--mono);cursor:pointer;appearance:auto}
.oai-btn{background:transparent;border:1px solid var(--border);border-radius:3px;padding:4px 8px;cursor:pointer;font-size:12px;color:var(--ink-sub);transition:background .15s}
.oai-btn:hover{background:var(--border-light)}

.toast.show{opacity:1;transform:translateY(0)}
</style>
</head>
<body>
<div class="toast" id="toast"></div>
<div class="container">
<h1>Gaia Control Center</h1>
<p class="sub"><span class="dot"></span>All bots &mdash; auto-refresh 5s</p>

<div class="bots" id="bots"></div>

<div class="tab-select" id="botSelect"></div>

<div class="tabs">
  <button class="tab active" onclick="showPanel('pipeline')">Pipeline</button>
  <button class="tab" onclick="showPanel('memory')">Memory</button>
  <button class="tab" onclick="showPanel('logs')">Logs</button>
  <button class="tab" onclick="showPanel('errors')">Errors</button>
</div>

<div class="panel active" id="panel-pipeline">
  <div class="wf-legend">
    <span><i style="background:#2d5f8a"></i>S1</span>
    <span><i style="background:#5e6e82"></i>S2</span>
    <span><i style="background:#c49a3f"></i>S3S4</span>
    <span><i style="background:#6a7d5a"></i>S5</span>
    <span><i style="background:#c06b4e"></i>S5.5</span>
    <span><i style="background:#a14b35"></i>S6</span>
  </div>
  <div id="waterfall"></div>
</div>

<div class="panel" id="panel-memory"><div id="memContent"></div></div>
<div class="panel" id="panel-logs">
  <div class="log-filters">
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="info">info</label>
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="warn">warn</label>
    <label><input type="checkbox" checked onchange="updateLogFilter()" data-level="error">error</label>
  </div>
  <div class="log-box" id="logBox"></div>
</div>
<div class="panel" id="panel-errors"><div id="errContent"></div></div>

<p class="footer" id="footer"></p>
</div>

<script>
let currentBot = '';
let logLines = [];
let logFilter = {info:true,warn:true,error:true};
let evtSource = null;
// advOpen state persisted in localStorage so 5s DOM rebuild doesn't reset it
const botSchedState = {}; // botName -> {type,time,hours}

function isAdvOpen(name) { try { return localStorage.getItem('adv_'+name)==='1'; } catch { return false; } }
function setAdvOpen(name, v) { try { localStorage.setItem('adv_'+name, v?'1':'0'); } catch {} }

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.borderColor = isErr ? '#7f1d1d' : '#3f3f46';
  el.style.color = isErr ? '#fca5a5' : '#e4e4e7';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Tabs / panels ──────────────────────────────────────────────────────
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  event.target.classList.add('active');
  if (name === 'logs') connectSSE();
}

function selectBot(name) {
  currentBot = name;
  document.querySelectorAll('#botSelect button').forEach(b => b.classList.toggle('active', b.dataset.bot === name));
  refreshPanels();
  connectSSE();
}

// ── SSE / logs ─────────────────────────────────────────────────────────
function connectSSE() {
  if (evtSource) evtSource.close();
  if (!currentBot) return;
  logLines = [];
  evtSource = new EventSource('/api/logs/'+currentBot+'/stream');
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
    .map(l => '<div class="log-line"><span class="ts">['+l.ts+']</span> <span class="'+l.level+'">['+l.level+']</span> '+escHtml(l.msg)+'</div>')
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

function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Process control ────────────────────────────────────────────────────
async function botAction(botName, action, btn) {
  btn.disabled = true;
  btn.classList.add('loading');
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const r = await fetch('/api/bot/'+botName+'/'+action, { method:'POST' });
    const d = await r.json();
    if (d.ok) {
      toast(botName + ' ' + action + ' OK');
      setTimeout(refresh, 1200);
    } else {
      toast(d.error || 'failed', true);
      btn.disabled = false;
      btn.classList.remove('loading');
      btn.textContent = orig;
    }
  } catch(e) {
    toast(String(e), true);
    btn.disabled = false;
    btn.classList.remove('loading');
    btn.textContent = orig;
  }
}

// ── Autostart ──────────────────────────────────────────────────────────
async function saveApiKey() {
  const inp = document.getElementById('openai_key_input');
  const key = inp.value.trim();
  if (!key) { toast('请输入 API Key', true); return; }
  try {
    const r = await fetch('/api/openai-key', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key}) });
    const d = await r.json();
    if (d.ok) {
      toast('API Key 已保存，Bot 重启中');
      inp.type = 'password';
      inp.dataset.revealed = '0';
      _modelsCache = null; loadModels(true);
    } else { toast(d.error || 'failed', true); }
  } catch(e) { toast(String(e), true); }
}

function toggleKeyVisibility() {
  const inp = document.getElementById('openai_key_input');
  const revealed = inp.dataset.revealed === '1';
  inp.type = revealed ? 'password' : 'text';
  inp.dataset.revealed = revealed ? '0' : '1';
}

let _modelsCache = null;
async function loadModels(force) {
  const selTool = document.getElementById('openai_model_select');
  const selChat = document.getElementById('openai_chat_model_select');
  // Use cache to avoid flicker on 5s refresh
  if (!force && _modelsCache) {
    if (selTool) selTool.innerHTML = _modelsCache.models.map(m => '<option value="'+m+'"'+(m===_modelsCache.current?' selected':'')+'>'+m+'</option>').join('');
    if (selChat) selChat.innerHTML = _modelsCache.models.map(m => '<option value="'+m+'"'+(m===_modelsCache.currentChat?' selected':'')+'>'+m+'</option>').join('');
    return;
  }
  try {
    const d = await (await fetch('/api/openai-models')).json();
    if (!d.ok) {
      if (selTool) selTool.innerHTML = '<option>— 请先填写 API Key —</option>';
      if (selChat) selChat.innerHTML = '<option>— 请先填写 API Key —</option>';
      return;
    }
    _modelsCache = d;
    if (selTool) selTool.innerHTML = d.models.map(m => '<option value="'+m+'"'+(m===d.current?' selected':'')+'>'+m+'</option>').join('');
    if (selChat) selChat.innerHTML = d.models.map(m => '<option value="'+m+'"'+(m===d.currentChat?' selected':'')+'>'+m+'</option>').join('');
  } catch {
    if (selTool) selTool.innerHTML = '<option>— 加载失败 —</option>';
    if (selChat) selChat.innerHTML = '<option>— 加载失败 —</option>';
  }
}

async function switchModel(sel, type) {
  const model = sel.value;
  sel.disabled = true;
  const label = type === 'chat' ? '聊天模型' : '工具模型';
  try {
    const r = await fetch('/api/openai-model', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model, type}) });
    const d = await r.json();
    if (d.ok) { toast(label+' 已切换为 '+model+'，Bot 重启中'); _modelsCache = null; loadModels(true); }
    else { toast(d.error || 'failed', true); }
  } catch(e) { toast(String(e), true); }
  finally { sel.disabled = false; }
}

function pickPersonaFile(input) {
  if (!input.files || !input.files[0]) return;
  // File picker gives filename only; we need the full path.
  // Browser security prevents reading full path — show the name and let user confirm/edit.
  const name = input.files[0].name;
  const inp = document.getElementById('persona_path_input');
  if (inp) { inp.value = name; inp.focus(); }
  toast('已选择 '+name+'，请确认路径后点击切换');
}

async function savePersona() {
  const inp = document.getElementById('persona_path_input');
  const p = inp.value.trim();
  if (!p) { toast('请输入 persona 文件路径', true); return; }
  try {
    const r = await fetch('/api/persona', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({path:p}) });
    const d = await r.json();
    if (d.ok) { toast('Persona 已切换为 '+p+'，Bot 重启中'); }
    else { toast(d.error || 'failed', true); }
  } catch(e) { toast(String(e), true); }
}

async function toggleProactive(botName, cb) {
  const enable = cb.checked;
  cb.disabled = true;
  try {
    const r = await fetch('/api/proactive/'+botName, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled:enable}) });
    const d = await r.json();
    if (d.ok) {
      toast('主动发言 '+(enable?'已开启':'已关闭'));
    } else {
      toast(d.error || 'failed', true);
      cb.checked = !enable;
    }
  } catch(e) {
    toast(String(e), true);
    cb.checked = !enable;
  } finally { cb.disabled = false; }
}

async function toggleAutostart(botName, cb) {
  const enable = cb.checked;
  cb.disabled = true;
  try {
    const r = await fetch('/api/autostart/'+(enable?'enable':'disable'), { method:'POST' });
    const d = await r.json();
    if (d.ok) {
      toast('随系统启动 '+(enable?'已开启':'已关闭'));
    } else {
      toast(d.error || 'failed', true);
      cb.checked = !enable; // revert
    }
  } catch(e) {
    toast(String(e), true);
    cb.checked = !enable;
  }
  cb.disabled = false;
}

// ── Schedule ───────────────────────────────────────────────────────────
async function saveSchedule(botName) {
  const state = botSchedState[botName] || {};
  const type = document.querySelector('input[name="sched_'+botName+'"]:checked')?.value || 'none';
  let sched = { type };
  if (type === 'daily') {
    sched.time = document.getElementById('sched_time_'+botName)?.value || '22:00';
  }
  if (type === 'delay') {
    const h = parseFloat(document.getElementById('sched_hours_'+botName)?.value || '2');
    sched.until = Date.now() + h * 3600_000;
    sched.hours = h;
  }
  try {
    const r = await fetch('/api/schedule/'+botName, { method:'POST', body: JSON.stringify(sched), headers:{'Content-Type':'application/json'} });
    const d = await r.json();
    toast(d.ok ? '定时已保存' : (d.error||'failed'), !d.ok);
  } catch(e) { toast(String(e), true); }
}

function toggleAdv(botName) {
  const next = !isAdvOpen(botName);
  setAdvOpen(botName, next);
  const panel = document.getElementById('adv_'+botName);
  const btn   = document.getElementById('advbtn_'+botName);
  if (panel) panel.classList.toggle('open', next);
  if (btn) btn.textContent = (next ? '▴' : '▾') + ' 自动 & 定时';
}

// ── Render bot cards ───────────────────────────────────────────────────
async function renderBotCards(bots) {
  // Fetch autostart status once
  let autoEnabled = false;
  try { autoEnabled = (await (await fetch('/api/autostart')).json()).enabled; } catch {}

  let html = '';
  for (const b of bots) {
    const on = b.status === 'online';
    const stopped = b.status === 'stopped';
    const name = b.name;

    // Fetch schedule for this bot
    let sched = { type: 'none' };
    try { sched = await (await fetch('/api/schedule/'+name)).json(); } catch {}
    botSchedState[name] = sched;

    html += '<div class="bot-card">';
    html += '<h2>'+escHtml(name)+' <span class="badge '+(on?'on':'off')+'">'+(on?'ONLINE':'OFFLINE')+'</span></h2>';
    html += '<div class="row"><span class="k">PID</span><span class="v">'+(b.pid||'-')+'</span></div>';
    html += '<div class="row"><span class="k">Uptime</span><span class="v">'+b.uptime+'</span></div>';
    html += '<div class="row"><span class="k">Restarts</span><span class="v">'+b.restarts+'</span></div>';
    html += '<div class="row"><span class="k">Memory</span><span class="v">'+b.memory+' MB</span></div>';
    html += '<div class="row"><span class="k">CPU</span><span class="v">'+b.cpu+'%</span></div>';

    // Control buttons
    const dn = escHtml(name);
    html += '<div class="ctrl-row">';
    html += '<button class="ctrl-btn start" data-bot="'+dn+'" data-act="start" '+(on?'disabled':'')+' onclick="botAction(this.dataset.bot,this.dataset.act,this)">▶ 启动</button>';
    html += '<button class="ctrl-btn stop"  data-bot="'+dn+'" data-act="stop"  '+(!on?'disabled':'')+' onclick="botAction(this.dataset.bot,this.dataset.act,this)">■ 停止</button>';
    html += '<button class="ctrl-btn restart" data-bot="'+dn+'" data-act="restart" '+((!on&&!stopped)?'disabled':'')+' onclick="botAction(this.dataset.bot,this.dataset.act,this)">↺ 重启</button>';
    html += '</div>';

    // Advanced toggle
    const isOpen = isAdvOpen(name);
    html += '<button class="adv-toggle" id="advbtn_'+dn+'" data-bot="'+dn+'" onclick="toggleAdv(this.dataset.bot)">'+(isOpen?'▴':'▾')+' 自动 & 定时</button>';
    html += '<div class="adv-panel'+(isOpen?' open':'')+'" id="adv_'+dn+'">';

    // Proactive toggle (per-bot, runtime_config)
    let proactiveOn = true;
    try { proactiveOn = (await (await fetch('/api/proactive/'+name)).json()).enabled; } catch {}
    html += '<div class="sw-row">';
    html += '<div><div class="sw-label">主动发言</div><div class="sw-sub">Bot 会在沉默一段时间后主动找人聊天</div></div>';
    html += '<label class="switch"><input type="checkbox" '+(proactiveOn?'checked':'')+' data-bot="'+dn+'" onchange="toggleProactive(this.dataset.bot,this)"><span class="slider"></span></label>';
    html += '</div>';

    // Autostart row (shared — controls PM2 resurrect globally)
    html += '<div class="sw-row">';
    html += '<div><div class="sw-label">随系统启动</div><div class="sw-sub">开机自动运行所有 PM2 进程</div></div>';
    html += '<label class="switch"><input type="checkbox" '+(autoEnabled?'checked':'')+' data-bot="'+dn+'" onchange="toggleAutostart(this.dataset.bot,this)"><span class="slider"></span></label>';
    html += '</div>';

    // Schedule rows
    const schedType = sched.type || 'none';
    const schedTime = sched.time || '22:00';
    const schedHours = sched.hours || 2;
    html += '<div style="margin-top:10px;font-size:12px;color:#52525b;margin-bottom:4px">定时关闭</div>';
    html += '<div class="sched-options">';
    html += '<label class="sched-opt"><input type="radio" name="sched_'+dn+'" value="none" '+(schedType==='none'?'checked':'')+'>不启用</label>';
    html += '<label class="sched-opt"><input type="radio" name="sched_'+dn+'" value="daily" '+(schedType==='daily'?'checked':'')+'>每天定时&nbsp;<input class="sched-input" id="sched_time_'+dn+'" type="time" value="'+schedTime+'" style="width:80px"></label>';
    html += '<label class="sched-opt"><input type="radio" name="sched_'+dn+'" value="delay" '+(schedType==='delay'?'checked':'')+'>延时关闭&nbsp;<input class="sched-input" id="sched_hours_'+dn+'" type="number" min="0.5" max="24" step="0.5" value="'+schedHours+'" style="width:60px">&nbsp;小时后</label>';
    html += '</div>';
    html += '<button class="sched-save" data-bot="'+dn+'" onclick="saveSchedule(this.dataset.bot)">保存定时</button>';

    // OpenAI config section
    let maskedKey = '';
    try { maskedKey = (await (await fetch('/api/openai-key')).json()).masked || ''; } catch {}
    html += '<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">';
    html += '<div style="font-size:12px;color:var(--ink-sub);margin-bottom:8px">OpenAI 配置</div>';
    // API Key row
    html += '<div class="oai-row">';
    html += '<span class="oai-label">API Key</span>';
    html += '<input id="openai_key_input" class="oai-input" type="password" data-revealed="0" placeholder="'+escHtml(maskedKey || 'sk-proj-...')+'">';
    html += '<button class="oai-btn" onclick="toggleKeyVisibility()" title="显示/隐藏">👁</button>';
    html += '<button class="sched-save" onclick="saveApiKey()">保存</button>';
    html += '</div>';
    // Chat model row
    html += '<div class="oai-row" style="margin-top:8px">';
    html += '<span class="oai-label">聊天模型</span>';
    html += '<select id="openai_chat_model_select" class="oai-select" onchange="switchModel(this,\'chat\')"><option>加载中...</option></select>';
    html += '</div>';
    // Tool model row
    html += '<div class="oai-row" style="margin-top:8px">';
    html += '<span class="oai-label">工具模型</span>';
    html += '<select id="openai_model_select" class="oai-select" onchange="switchModel(this,\'tool\')"><option>加载中...</option></select>';
    html += '<button class="oai-btn" onclick="_modelsCache=null;loadModels(true)" title="刷新">↺</button>';
    html += '</div>';
    html += '</div>';

    // Bot params section
    let personaPath = '';
    try { personaPath = (await (await fetch('/api/persona')).json()).path || ''; } catch {}
    html += '<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px">';
    html += '<div style="font-size:12px;color:var(--ink-sub);margin-bottom:8px">Bot 参数</div>';
    html += '<div class="oai-row">';
    html += '<span class="oai-label">Persona</span>';
    html += '<input id="persona_path_input" class="oai-input" type="text" value="'+escHtml(personaPath)+'" placeholder="./persona.yaml">';
    html += '<button class="oai-btn" data-target="persona_file_picker" onclick="document.getElementById(this.dataset.target).click()" title="选择文件">📂</button>';
    html += '<input type="file" id="persona_file_picker" accept=".yaml,.yml" style="display:none" onchange="pickPersonaFile(this)">';
    html += '<button class="sched-save" onclick="savePersona()">切换</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>'; // adv-panel
    html += '</div>'; // bot-card
  }
  document.getElementById('bots').innerHTML = html;
  loadModels(false);
}

// ── Main refresh ───────────────────────────────────────────────────────
async function refresh() {
  try {
    const bots = await (await fetch('/api/pm2')).json();
    let selectHtml = '';
    for (const b of bots) {
      selectHtml += '<button data-bot="'+escHtml(b.name)+'" onclick="selectBot(this.dataset.bot)" class="'+(b.name===currentBot?'active':'')+'">'+escHtml(b.name)+'</button>';
    }
    await renderBotCards(bots);
    document.getElementById('botSelect').innerHTML = selectHtml;
    if (!currentBot && bots.length) selectBot(bots[0].name);
    else refreshPanels();
    document.getElementById('footer').textContent = 'localhost:3400 — ' + new Date().toLocaleTimeString('zh-CN');
  } catch(e) { console.error(e); }
}

async function refreshPanels() {
  if (!currentBot) return;
  // Pipeline
  try {
    const timings = await (await fetch('/api/timings/'+currentBot)).json();
    let wf = '';
    for (const t of timings) {
      const maxMs = Math.max(t.total_ms, 1);
      const stageMap = {
        'S1:MessageDispatcher':'s1','S2:ContextAssembler':'s2',
        'S3S4:CognitiveGenerator':'s3s4','S4.5:BiographicalExtractor':'s2',
        'S4.6:MemoryExtractor':'s2','S5:PerceptionWrapper':'s5',
        'S5.5:AntiAiValidator':'s55','S6:OutboundScheduler':'s6'
      };
      let bars = '';
      for (const [stage, ms] of Object.entries(t.stages)) {
        const pct = Math.max((ms/maxMs)*100, 3);
        const cls = stageMap[stage] || 's2';
        bars += '<div class="wf-bar '+cls+'" style="width:'+pct+'%" title="'+stage+': '+ms+'ms">'+(ms>200?ms+'':'')+'</div>';
      }
      wf += '<div class="wf-row"><span class="wf-sender">'+(t.sender_name||'?')+'</span><div class="wf-bars">'+bars+'</div><span class="wf-total">'+t.total_ms+'ms</span></div>';
    }
    document.getElementById('waterfall').innerHTML = wf || '<div style="color:#52525b;font-size:13px">No pipeline data yet</div>';
  } catch {}

  // Memory
  try {
    const mem = await (await fetch('/api/memory/'+currentBot)).json();
    let h = '<div class="mem-grid">';
    h += '<div class="mem-card green"><div class="num">'+(mem.ltm||0)+'</div><div class="lbl">Long-term</div></div>';
    h += '<div class="mem-card blue"><div class="num">'+(mem.bio||0)+'</div><div class="lbl">Bio Facts</div></div>';
    const ss = mem.selfState||{};
    h += '<div class="mem-card yellow"><div class="num">'+(typeof ss.mood_baseline==='number'?ss.mood_baseline.toFixed(2):'-')+'</div><div class="lbl">Mood</div></div>';
    h += '<div class="mem-card purple"><div class="num">'+(typeof ss.social_battery==='number'?ss.social_battery.toFixed(2):'-')+'</div><div class="lbl">Battery</div></div>';
    h += '</div>';
    if (mem.users?.length) {
      h += '<h3 style="font-size:14px;color:#a1a1aa;margin:12px 0 8px">Users</h3><table><tr><th>Name</th><th>Messages</th><th>Stage</th><th>Intimacy</th></tr>';
      const relMap = {};
      (mem.relationships||[]).forEach(r => relMap[r.user_id] = r);
      for (const u of mem.users) {
        const r = relMap[u.user_id] || {};
        h += '<tr><td>'+(u.display_name||u.user_id.slice(0,8))+'</td><td>'+u.message_count+'</td><td>'+(r.stage||u.relationship_stage||'-')+'</td><td>'+(typeof r.intimacy_score==='number'?r.intimacy_score.toFixed(2):'-')+'</td></tr>';
      }
      h += '</table>';
    }
    if (mem.promises?.length) {
      h += '<h3 style="font-size:14px;color:#a1a1aa;margin:12px 0 8px">Active Promises</h3>';
      for (const p of mem.promises) {
        h += '<div style="padding:6px 0;font-size:13px;border-bottom:1px solid #1f1f23"><span style="color:'+(p.status==='active'?'#22c55e':'#71717a')+'">['+(p.status||'active')+']</span> '+escHtml(p.content)+'</div>';
      }
    }
    document.getElementById('memContent').innerHTML = h;
  } catch {}

  // Errors
  try {
    const err = await (await fetch('/api/errors/'+currentBot)).json();
    let h = '<div class="mem-grid">';
    h += '<div class="mem-card red"><div class="num">'+err.errors+'</div><div class="lbl">Errors (200 lines)</div></div>';
    h += '<div class="mem-card yellow"><div class="num">'+err.warns+'</div><div class="lbl">Warnings</div></div>';
    h += '</div>';
    if (err.recent?.length) {
      h += '<h3 style="font-size:14px;color:#a1a1aa;margin:12px 0 8px">Recent Errors</h3>';
      for (const e of err.recent) h += '<div class="err-row">['+e.ts+'] '+escHtml(e.msg)+'</div>';
    }
    document.getElementById('errContent').innerHTML = h;
  } catch {}
}

// ── Init ───────────────────────────────────────────────────────────────
refresh();
setInterval(refresh, 5000);

(async () => {
  if (!currentBot) return;
  try {
    const logs = await (await fetch('/api/logs/'+currentBot)).json();
    logLines = logs;
    renderLogs();
  } catch {}
})();
</script>
</body>
</html>`;
}

// ── HTTP Server ──

startLogWatchers();
loadAllSchedules();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // API: PM2 process list
  if (p === '/api/pm2') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiPm2()));
  }

  // API: Bot process control (start / stop / restart / delete)
  const ctrlMatch = p.match(/^\/api\/bot\/([^/]+)\/(start|stop|restart|delete)$/);
  if (ctrlMatch && req.method === 'POST') {
    const [, botName, action] = ctrlMatch;
    let result;
    if (action === 'start')   result = apiStart(botName);
    if (action === 'stop')    result = apiStop(botName);
    if (action === 'restart') result = apiRestart(botName);
    if (action === 'delete')  result = apiDelete(botName);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  // API: Autostart
  if (p === '/api/autostart') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiAutostartStatus()));
  }
  const autostartMatch = p.match(/^\/api\/autostart\/(enable|disable)$/);
  if (autostartMatch && req.method === 'POST') {
    const result = autostartMatch[1] === 'enable' ? apiAutostartEnable() : apiAutostartDisable();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(result));
  }

  // API: Schedule shutdown
  const schedGetMatch = p.match(/^\/api\/schedule\/([^/]+)$/);
  if (schedGetMatch && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiGetSchedule(schedGetMatch[1])));
  }
  if (schedGetMatch && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const sched = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(apiSetSchedule(schedGetMatch[1], sched)));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
      }
    });
    return;
  }

  // API: Proactive toggle (read/write runtime_config proactive_enabled)
  const proactiveMatch = p.match(/^\/api\/proactive\/([^/]+)$/);
  if (proactiveMatch) {
    const botName = proactiveMatch[1];
    const db = getScheduleDb(botName);
    if (!db) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'db not found' }));
    }
    if (req.method === 'GET') {
      try {
        const row = db.prepare('SELECT value FROM runtime_config WHERE key = ?').get('proactive_enabled');
        db.close();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, enabled: !row || row.value !== 'false' }));
      } catch { db.close(); res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false })); }
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', d => body += d);
      req.on('end', () => {
        try {
          const { enabled } = JSON.parse(body);
          db.prepare(`INSERT INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
            .run('proactive_enabled', enabled ? 'true' : 'false', Date.now());
          db.close();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, enabled }));
        } catch { db.close(); res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); }
      });
      return;
    }
  }

  // API: OpenAI Key — read (masked)
  if (p === '/api/openai-key' && req.method === 'GET') {
    const key = readEnvValue('OPENAI_API_KEY');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, configured: !!key, masked: maskKey(key) }));
  }
  // API: OpenAI Key — write
  if (p === '/api/openai-key' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        if (!key) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing key' })); }
        writeEnvValue('OPENAI_API_KEY', key);
        try { execSync(PM2_BIN + ' restart gaia-bot --update-env', { timeout: 10000 }); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // API: OpenAI Models — list available
  if (p === '/api/openai-models' && req.method === 'GET') {
    const apiKey = readEnvValue('OPENAI_API_KEY');
    const currentModel = readEnvValue('OPENAI_MODEL');
    if (!apiKey) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'no api key' }));
    }
    (async () => {
      try {
        const r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': 'Bearer ' + apiKey }, signal: AbortSignal.timeout(10000) });
        const data = await r.json();
        const models = (data.data || []).map(m => m.id).sort();
        const currentChatModel = readEnvValue('OPENAI_CHAT_MODEL') || 'gpt-5-mini';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, models, current: currentModel, currentChat: currentChatModel }));
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    })();
    return;
  }

  // API: OpenAI Model — switch
  if (p === '/api/openai-model' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { model, type } = JSON.parse(body);
        if (!model) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing model' })); }
        const envKey = type === 'chat' ? 'OPENAI_CHAT_MODEL' : 'OPENAI_MODEL';
        writeEnvValue(envKey, model);
        try { execSync(PM2_BIN + ' restart gaia-bot --update-env', { timeout: 10000 }); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // API: Persona config — read current
  if (p === '/api/persona' && req.method === 'GET') {
    const current = readEnvValue('PERSONA_CONFIG') || './persona.yaml';
    const abs = path.resolve(__dirname, '..', current);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, path: current, absolutePath: abs, exists: fs.existsSync(abs) }));
  }
  // API: Persona config — switch
  if (p === '/api/persona' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { path: newPath } = JSON.parse(body);
        if (!newPath) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'missing path' })); }
        const abs = path.isAbsolute(newPath) ? newPath : path.resolve(__dirname, '..', newPath);
        if (!fs.existsSync(abs)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: '文件不存在: ' + abs })); }
        writeEnvValue('PERSONA_CONFIG', newPath);
        try { execSync(PM2_BIN + ' restart gaia-bot --update-env', { timeout: 10000 }); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: newPath }));
      } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false })); }
    });
    return;
  }

  // API: Memory for a bot
  const memMatch = p.match(/^\/api\/memory\/(.+)$/);
  if (memMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiMemory(memMatch[1])));
  }

  // API: Pipeline timings
  const timMatch = p.match(/^\/api\/timings\/(.+)$/);
  if (timMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiTimings(timMatch[1])));
  }

  // API: Error aggregation
  const errMatch = p.match(/^\/api\/errors\/(.+)$/);
  if (errMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiErrors(errMatch[1])));
  }

  // API: Log snapshot
  const logMatch = p.match(/^\/api\/logs\/([^/]+)$/);
  if (logMatch) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(apiLogs(logMatch[1])));
  }

  // SSE: Live log stream
  const sseMatch = p.match(/^\/api\/logs\/([^/]+)\/stream$/);
  if (sseMatch) {
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

  // HTML page
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getPage());
});

server.listen(PORT, () => {
  console.log(`Gaia Control Center v2 running at http://localhost:${PORT}`);
});
