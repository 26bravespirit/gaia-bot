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
const { execSync } = require('child_process');

const PORT = 3400;

// Bot DB paths (auto-discovered from PM2 cwd)
const BOT_CONFIGS = {
  'gaia-bot': {
    db: path.resolve(__dirname, '../data/persona.db'),
    log: path.resolve(__dirname, '../logs/persona-bot.log'),
  },
  'persona-bot': {
    db: process.env.PERSONA_BOT_DB || path.join(process.env.HOME, '本地文档/claude code/对话服务/persona-bot/data/persona.db'),
    log: process.env.PERSONA_BOT_LOG || path.join(process.env.HOME, '本地文档/claude code/对话服务/persona-bot/logs/persona-bot.log'),
  },
};

let Database;
try { Database = require('better-sqlite3'); } catch { Database = null; }

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
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro',sans-serif;background:#09090b;color:#e4e4e7;min-height:100vh;padding:24px}
.container{max-width:1100px;margin:0 auto}
h1{font-size:24px;font-weight:600;color:#fff;margin-bottom:4px}
.sub{color:#52525b;font-size:13px;margin-bottom:24px}
.sub .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#22c55e;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Bot cards */
.bots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}
.bot-card{background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px}
.bot-card h2{font-size:16px;font-weight:500;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.badge{padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600}
.badge.on{background:rgba(34,197,94,.15);color:#22c55e}
.badge.off{background:rgba(239,68,68,.15);color:#ef4444}
.row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px solid #1f1f23}
.row:last-child{border:none}
.row .k{color:#71717a}
.row .v{font-family:'SF Mono',monospace;font-size:12px}

/* Tabs */
.tabs{display:flex;gap:4px;margin-bottom:16px;border-bottom:1px solid #27272a;padding-bottom:8px}
.tab{padding:6px 16px;border-radius:8px;font-size:13px;cursor:pointer;color:#71717a;background:transparent;border:none;transition:all .2s}
.tab:hover{color:#a1a1aa}
.tab.active{background:#27272a;color:#fff}
.tab-select{display:flex;gap:4px;margin-bottom:12px}
.tab-select button{padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer;color:#71717a;background:transparent;border:1px solid #27272a}
.tab-select button.active{background:#27272a;color:#fff}

/* Panels */
.panel{display:none;background:#18181b;border:1px solid #27272a;border-radius:12px;padding:20px;margin-bottom:16px}
.panel.active{display:block}

/* Memory cards */
.mem-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px}
.mem-card{background:#1f1f23;border-radius:8px;padding:12px;text-align:center}
.mem-card .num{font-size:24px;font-weight:700;font-family:'SF Mono',monospace}
.mem-card .lbl{color:#71717a;font-size:11px;margin-top:2px}
.green .num{color:#22c55e}.blue .num{color:#3b82f6}.purple .num{color:#a855f7}.yellow .num{color:#eab308}.red .num{color:#ef4444}

/* Users table */
table{width:100%;font-size:13px;border-collapse:collapse}
th{text-align:left;color:#71717a;font-weight:500;padding:6px 8px;border-bottom:1px solid #27272a}
td{padding:6px 8px;border-bottom:1px solid #1f1f23}

/* Waterfall */
.wf-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid #1f1f23}
.wf-sender{width:80px;color:#71717a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-bars{flex:1;display:flex;height:18px;border-radius:4px;overflow:hidden}
.wf-bar{height:100%;min-width:2px;display:flex;align-items:center;justify-content:center;font-size:9px;color:#fff;overflow:hidden}
.wf-total{width:50px;text-align:right;font-family:'SF Mono',monospace;color:#a1a1aa}
.wf-bar.s1{background:#3b82f6}.wf-bar.s2{background:#8b5cf6}.wf-bar.s3s4{background:#f59e0b}.wf-bar.s5{background:#22c55e}.wf-bar.s55{background:#06b6d4}.wf-bar.s6{background:#ef4444}
.wf-legend{display:flex;gap:12px;font-size:11px;color:#71717a;margin-bottom:8px}
.wf-legend span{display:flex;align-items:center;gap:4px}
.wf-legend i{width:10px;height:10px;border-radius:2px;display:inline-block}

/* Logs */
.log-box{background:#0a0a0a;border-radius:8px;padding:12px;max-height:360px;overflow-y:auto;font-family:'SF Mono',monospace;font-size:12px;line-height:1.7}
.log-line{white-space:pre-wrap;word-break:break-all}
.log-line .ts{color:#52525b}.log-line .info{color:#3b82f6}.log-line .warn{color:#eab308}.log-line .error{color:#ef4444}
.log-filters{display:flex;gap:4px;margin-bottom:8px}
.log-filters label{font-size:11px;color:#71717a;display:flex;align-items:center;gap:4px;cursor:pointer}
.log-filters input{accent-color:#3b82f6}

/* Errors */
.err-row{padding:8px;background:#1c1917;border-radius:6px;margin-bottom:6px;font-size:12px;font-family:'SF Mono',monospace;color:#fca5a5}

.footer{text-align:center;color:#27272a;font-size:11px;margin-top:32px}
</style>
</head>
<body>
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
    <span><i style="background:#3b82f6"></i>S1</span>
    <span><i style="background:#8b5cf6"></i>S2</span>
    <span><i style="background:#f59e0b"></i>S3S4</span>
    <span><i style="background:#22c55e"></i>S5</span>
    <span><i style="background:#06b6d4"></i>S5.5</span>
    <span><i style="background:#ef4444"></i>S6</span>
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

function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function refresh() {
  try {
    const bots = await (await fetch('/api/pm2')).json();
    let html = '';
    let selectHtml = '';
    for (const b of bots) {
      const on = b.status === 'online';
      html += '<div class="bot-card"><h2>'+b.name+' <span class="badge '+(on?'on':'off')+'">'+(on?'ONLINE':'OFFLINE')+'</span></h2>';
      html += '<div class="row"><span class="k">PID</span><span class="v">'+b.pid+'</span></div>';
      html += '<div class="row"><span class="k">Uptime</span><span class="v">'+b.uptime+'</span></div>';
      html += '<div class="row"><span class="k">Restarts</span><span class="v">'+b.restarts+'</span></div>';
      html += '<div class="row"><span class="k">Memory</span><span class="v">'+b.memory+' MB</span></div>';
      html += '<div class="row"><span class="k">CPU</span><span class="v">'+b.cpu+'%</span></div></div>';
      selectHtml += '<button data-bot="'+b.name+'" onclick="selectBot(\\''+b.name+'\\')" class="'+(b.name===currentBot?'active':'')+'">'+b.name+'</button>';
    }
    document.getElementById('bots').innerHTML = html;
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
        bars += '<div class="wf-bar '+cls+'" style="width:'+pct+'%" title="'+stage+': '+ms+'ms">'+( ms>200?ms+'':'')+'</div>';
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

// Initial load + auto-refresh
refresh();
setInterval(refresh, 5000);

// Load initial logs
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
