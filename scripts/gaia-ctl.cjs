#!/usr/bin/env node
/**
 * gaia-ctl -- Gaia 双通道管理 CLI
 *
 * 用法:
 *   node scripts/gaia-ctl.cjs status          # 查看两个通道状态
 *   node scripts/gaia-ctl.cjs on feishu       # 启用 persona-bot 通道
 *   node scripts/gaia-ctl.cjs off lark        # 停用 lark-bot-worker 通道
 *   node scripts/gaia-ctl.cjs on all          # 同时启用两个通道
 *   node scripts/gaia-ctl.cjs off all         # 同时停用两个通道
 *   node scripts/gaia-ctl.cjs routing         # 查看路由规则
 *   node scripts/gaia-ctl.cjs dashboard       # 启动 Web 仪表盘 (localhost:3456)
 */

const Database = require('better-sqlite3');
const path = require('path');
const { execSync, spawn } = require('child_process');
const fs = require('fs');

// ── paths ──────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DB_PATH = path.resolve(PROJECT_ROOT, 'data/persona.db');
const PID_FILE = path.resolve(PROJECT_ROOT, 'data/persona-bot.pid');

// ── channel metadata ──────────────────────────────────────────────────
const CHANNELS = {
  feishu: {
    label: '飞书 persona-bot',
    configKey: 'channel_feishu_enabled',
    appId: 'cli_a9470826ebf9dcb2',
    brand: 'feishu',
    larkHome: path.join(process.env.HOME, '.local/share/GGBot/home'),
    processPattern: 'node.*dist/index\\.js',
    pidFile: PID_FILE,
  },
  lark: {
    label: 'Lark bot-worker',
    configKey: 'channel_lark_enabled',
    appId: 'cli_a94023f9bcb89ed2',
    brand: 'lark',
    larkHome: path.join(process.env.HOME, '.lark-cli'),
    processPattern: 'python3.*worker\\.py',
    pidFile: null,
  },
};

// ── helpers ────────────────────────────────────────────────────────────

function openDb(readonly = false) {
  return new Database(DB_PATH, { readonly });
}

function ensureDefaults(db) {
  const upsert = db.prepare(
    `INSERT OR IGNORE INTO runtime_config (key, value, updated_at)
     VALUES (?, ?, ?)`
  );
  const now = Date.now();
  upsert.run('channel_feishu_enabled', 'true', now);
  upsert.run('channel_lark_enabled', 'false', now);
  upsert.run(
    'routing_rules',
    JSON.stringify({ default: 'feishu', mention_lark_cli: 'lark', mention_gaia: 'feishu' }),
    now
  );
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

/** 通过 ps aux 查找进程, 返回 { pid, cmd, running } */
function detectProcess(pattern) {
  try {
    const out = execSync(`ps aux`, { encoding: 'utf8', timeout: 5000 });
    const lines = out.split('\n');
    const regex = new RegExp(pattern);
    for (const line of lines) {
      // 跳过 grep / ps 本身
      if (line.includes('grep') || line.includes('gaia-ctl')) continue;
      if (regex.test(line)) {
        const parts = line.trim().split(/\s+/);
        return { running: true, pid: parseInt(parts[1], 10), cmd: parts.slice(10).join(' ') };
      }
    }
  } catch (_) {
    // ps failed, treat as not running
  }
  return { running: false, pid: null, cmd: null };
}

/** 检查 lark-cli subscribe 是否活跃 */
function detectSubscribe(channel) {
  const ch = CHANNELS[channel];
  try {
    const out = execSync(`ps aux`, { encoding: 'utf8', timeout: 5000 });
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

function formatBool(v) {
  return v === 'true' ? '\x1b[32mON\x1b[0m' : '\x1b[31mOFF\x1b[0m';
}

function formatRunning(r) {
  return r ? '\x1b[32m运行中\x1b[0m' : '\x1b[90m未运行\x1b[0m';
}

// ── commands ───────────────────────────────────────────────────────────

function cmdStatus() {
  const db = openDb(true);
  ensureDefaults(openDb(false)); // 确保默认值存在 (用 rw 连接)

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║        Gaia 双通道状态面板                ║');
  console.log('╚══════════════════════════════════════════╝\n');

  for (const [name, ch] of Object.entries(CHANNELS)) {
    const enabled = getConfig(db, ch.configKey) || 'false';
    const proc = detectProcess(ch.processPattern);
    const sub = detectSubscribe(name);

    console.log(`  ┌─ ${ch.label} (${name}) ─────────────────`);
    console.log(`  │ 通道状态:   ${formatBool(enabled)}`);
    console.log(`  │ 进程:       ${formatRunning(proc.running)}${proc.pid ? ` (PID ${proc.pid})` : ''}`);
    console.log(`  │ Subscribe:  ${sub.active ? '\x1b[32m活跃\x1b[0m (PID ' + sub.pid + ')' : '\x1b[90m无\x1b[0m'}`);
    console.log(`  │ AppID:      ${ch.appId}`);
    console.log(`  │ Brand:      ${ch.brand}`);
    console.log(`  │ LARK_HOME:  ${ch.larkHome}`);
    console.log(`  └────────────────────────────────────────\n`);
  }

  // 记忆系统简要
  try {
    const ltmCount = db.prepare('SELECT COUNT(*) as c FROM long_term_memories').get().c;
    const bioCount = db.prepare('SELECT COUNT(*) as c FROM biographical_facts WHERE is_active=1').get().c;
    const rel = db.prepare('SELECT stage, intimacy_score, interaction_count FROM relationships LIMIT 1').get();
    const self = db.prepare('SELECT mood_baseline, energy_level, social_battery FROM self_state WHERE id=1').get();

    console.log('  ┌─ 记忆系统概览 ─────────────────────────');
    console.log(`  │ 长期记忆:    ${ltmCount} 条`);
    console.log(`  │ 传记事实:    ${bioCount} 条`);
    if (rel) {
      console.log(`  │ 关系阶段:    ${rel.stage} (亲密度: ${rel.intimacy_score.toFixed(3)}, 互动: ${rel.interaction_count})`);
    }
    if (self) {
      console.log(`  │ 心情基线:    ${self.mood_baseline}`);
      console.log(`  │ 能量/社交:   ${self.energy_level} / ${self.social_battery}`);
    }
    console.log('  └────────────────────────────────────────\n');
  } catch (_) {}

  db.close();
}

function cmdToggle(action, target) {
  if (!['on', 'off'].includes(action)) {
    console.error(`未知操作: ${action}, 请使用 on 或 off`);
    process.exit(1);
  }

  const targets = target === 'all' ? ['feishu', 'lark'] : [target];

  for (const t of targets) {
    if (!CHANNELS[t]) {
      console.error(`未知通道: ${t}, 可选: feishu, lark, all`);
      process.exit(1);
    }
  }

  const db = openDb(false);
  ensureDefaults(db);

  for (const t of targets) {
    const ch = CHANNELS[t];
    const value = action === 'on' ? 'true' : 'false';
    setConfig(db, ch.configKey, value);
    console.log(`  ${ch.label}: ${formatBool(value)}`);
  }

  db.close();
  console.log('\n  配置已更新。进程状态不受影响，请手动启停进程。');
}

function cmdRouting() {
  const db = openDb(true);
  const raw = getConfig(db, 'routing_rules');
  db.close();

  console.log('\n  ┌─ 路由规则 ─────────────────────────────');
  if (!raw) {
    console.log('  │ (未配置)');
  } else {
    try {
      const rules = JSON.parse(raw);
      for (const [key, val] of Object.entries(rules)) {
        console.log(`  │ ${key.padEnd(20)} -> ${val}`);
      }
    } catch (e) {
      console.log(`  │ (解析失败) ${raw}`);
    }
  }
  console.log('  └────────────────────────────────────────\n');
}

function cmdDashboard() {
  console.log('  启动 Gaia Dashboard ...');
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, 'gaia-dashboard.cjs')],
    { stdio: 'inherit' }
  );
  child.on('error', (err) => {
    console.error('  启动失败:', err.message);
    process.exit(1);
  });
}

// ── main ───────────────────────────────────────────────────────────────

const [cmd, arg] = process.argv.slice(2);

switch (cmd) {
  case 'status':
  case undefined:
    cmdStatus();
    break;
  case 'on':
  case 'off':
    if (!arg) {
      console.error('用法: gaia-ctl on|off <feishu|lark|all>');
      process.exit(1);
    }
    cmdToggle(cmd, arg);
    break;
  case 'routing':
    cmdRouting();
    break;
  case 'dashboard':
    cmdDashboard();
    break;
  default:
    console.error(`未知命令: ${cmd}`);
    console.error('可用命令: status, on, off, routing, dashboard');
    process.exit(1);
}
