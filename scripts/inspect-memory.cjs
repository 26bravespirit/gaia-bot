#!/usr/bin/env node
/**
 * 记忆系统检查工具
 * 用法: node scripts/inspect-memory.js [命令]
 *
 * 命令:
 *   all       - 显示所有记忆表状态（默认）
 *   ltm       - 只看长期记忆
 *   rel       - 只看关系模型
 *   bio       - 只看传记事实
 *   self      - 只看自我状态
 *   events    - 只看最近事件
 *   config    - 只看运行时配置
 *   conv [n]  - 只看最近 n 条对话（默认20）
 */

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/persona.db');
const db = new Database(dbPath, { readonly: true });

const cmd = process.argv[2] || 'all';

function showLTM() {
  console.log('\n=== 长期记忆 (long_term_memories) ===');
  const count = db.prepare('SELECT COUNT(*) as c FROM long_term_memories').get().c;
  console.log(`总条数: ${count}`);
  const rows = db.prepare('SELECT * FROM long_term_memories ORDER BY created_at DESC LIMIT 30').all();
  rows.forEach(r => {
    const date = new Date(r.created_at).toLocaleString('zh-CN');
    console.log(`  [${r.type}] (重要度:${r.importance}) ${r.content}`);
    console.log(`    关键词: ${r.keywords} | 用户: ${r.user_id} | 创建: ${date}`);
  });
}

function showRelationships() {
  console.log('\n=== 关系模型 (relationships) ===');
  const rows = db.prepare('SELECT * FROM relationships').all();
  rows.forEach(r => {
    console.log(`  用户: ${r.user_id}`);
    console.log(`    阶段: ${r.stage} | 亲密度: ${r.intimacy_score.toFixed(3)} | 互动次数: ${r.interaction_count}`);
    console.log(`    话题: ${r.topics_shared} | 承诺: ${r.promises}`);
  });
}

function showBio() {
  console.log('\n=== 传记事实 (biographical_facts) ===');
  const count = db.prepare('SELECT COUNT(*) as c FROM biographical_facts').get().c;
  console.log(`总条数: ${count} (anchor: ${db.prepare("SELECT COUNT(*) as c FROM biographical_facts WHERE source_type='anchor'").get().c}, generated: ${db.prepare("SELECT COUNT(*) as c FROM biographical_facts WHERE source_type='generated'").get().c})`);
  const rows = db.prepare('SELECT * FROM biographical_facts WHERE is_active=1 ORDER BY id DESC LIMIT 15').all();
  rows.forEach(r => {
    const prefix = r.source_type === 'anchor' ? '✓' : '~';
    console.log(`  ${prefix} [${r.period}] ${r.fact_content} (重要度:${r.importance}, 可信度:${r.confidence})`);
  });
}

function showSelf() {
  console.log('\n=== 自我状态 (self_state) ===');
  const row = db.prepare('SELECT * FROM self_state WHERE id=1').get();
  if (row) {
    console.log(`  心情基线: ${row.mood_baseline}`);
    console.log(`  活跃情绪: ${row.active_emotions}`);
    console.log(`  近期经历: ${row.recent_experiences}`);
    console.log(`  能量等级: ${row.energy_level}`);
    console.log(`  社交电量: ${row.social_battery}`);
    console.log(`  更新时间: ${new Date(row.updated_at).toLocaleString('zh-CN')}`);
  }
}

function showEvents() {
  console.log('\n=== 事件日志 (最近15条) ===');
  const count = db.prepare('SELECT COUNT(*) as c FROM event_log').get().c;
  console.log(`总条数: ${count}`);
  const rows = db.prepare('SELECT * FROM event_log ORDER BY id DESC LIMIT 15').all();
  rows.forEach(r => {
    const date = new Date(r.timestamp).toLocaleString('zh-CN');
    console.log(`  [${r.event_type}] ${date} | ${r.payload.slice(0, 80)}...`);
  });
}

function showConfig() {
  console.log('\n=== 运行时配置 (runtime_config) ===');
  const rows = db.prepare('SELECT * FROM runtime_config').all();
  rows.forEach(r => {
    console.log(`  ${r.key}: ${r.value}`);
  });
}

function showConv(n = 20) {
  console.log(`\n=== 最近 ${n} 条对话 ===`);
  const rows = db.prepare('SELECT role, content, sender_name, timestamp FROM conversation_log ORDER BY timestamp DESC LIMIT ?').all(n);
  rows.reverse().forEach(r => {
    const date = new Date(r.timestamp).toLocaleString('zh-CN');
    const tag = r.role === 'assistant' ? '🤖' : '👤';
    console.log(`  ${tag} [${date}] ${r.sender_name}: ${r.content.slice(0, 80)}${r.content.length > 80 ? '...' : ''}`);
  });
}

if (cmd === 'all' || cmd === 'ltm') showLTM();
if (cmd === 'all' || cmd === 'rel') showRelationships();
if (cmd === 'all' || cmd === 'bio') showBio();
if (cmd === 'all' || cmd === 'self') showSelf();
if (cmd === 'all' || cmd === 'events') showEvents();
if (cmd === 'all' || cmd === 'config') showConfig();
if (cmd === 'conv') showConv(parseInt(process.argv[3]) || 20);

db.close();
