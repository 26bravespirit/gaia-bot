#!/usr/bin/env tsx
/**
 * Bug tracker CLI for gaia-bot development.
 *
 * Usage:
 *   npx tsx bug-cli.ts report "标题" -s P1 -c pipeline -d "描述"
 *   npx tsx bug-cli.ts fix 1 --cause "根因" --fix "修复方案" --checkpoint "v1_xxx"
 *   npx tsx bug-cli.ts list [--status open] [--component engine]
 *   npx tsx bug-cli.ts get 1
 *   npx tsx bug-cli.ts close 1 --status wontfix
 *   npx tsx bug-cli.ts summary
 *   npx tsx bug-cli.ts export
 */

import Database from 'better-sqlite3';
import { writeFileSync, appendFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dirname || '.', 'data/bugs.db');
const LOG_PATH = resolve(import.meta.dirname || '.', 'BUG_LOG.md');
const REPORT_PATH = resolve(import.meta.dirname || '.', 'BUG_REPORT.md');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'P3',
    status TEXT NOT NULL DEFAULT 'open',
    component TEXT NOT NULL DEFAULT 'other',
    description TEXT DEFAULT '',
    steps_to_reproduce TEXT DEFAULT '',
    expected TEXT DEFAULT '',
    actual TEXT DEFAULT '',
    root_cause TEXT DEFAULT '',
    fix_description TEXT DEFAULT '',
    fix_checkpoint TEXT DEFAULT '',
    reported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    resolved_at TEXT,
    reporter TEXT DEFAULT 'dev',
    tags TEXT DEFAULT ''
  );
`);

function now(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function appendLog(text: string): void {
  if (!existsSync(LOG_PATH)) {
    writeFileSync(LOG_PATH, '# Gaia-bot Bug Log\n\n', 'utf-8');
  }
  appendFileSync(LOG_PATH, text, 'utf-8');
}

// ── Commands ──

function report(args: string[]): void {
  const title = args[0];
  if (!title) { console.error('Usage: report "title" [-s severity] [-c component] [-d desc]'); return; }
  let severity = 'P3', component = 'other', desc = '', steps = '', expected = '', actual = '', tags = '';
  for (let i = 1; i < args.length; i += 2) {
    const v = args[i + 1] || '';
    if (args[i] === '-s') severity = v;
    else if (args[i] === '-c') component = v;
    else if (args[i] === '-d') desc = v;
    else if (args[i] === '--steps') steps = v;
    else if (args[i] === '--expected') expected = v;
    else if (args[i] === '--actual') actual = v;
    else if (args[i] === '--tags') tags = v;
  }
  const ts = now();
  const result = db.prepare(`
    INSERT INTO bugs (title, severity, status, component, description, steps_to_reproduce, expected, actual, reported_at, updated_at, tags)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, severity, component, desc, steps, expected, actual, ts, ts, tags);
  const id = result.lastInsertRowid;
  console.log(`BUG-${String(id).padStart(3, '0')} created (${severity}, ${component})`);
  appendLog(`## [${ts}] BUG-${String(id).padStart(3, '0')} REPORTED\n\n- **标题**: ${title}\n- **严重度**: ${severity}\n- **组件**: ${component}\n${desc ? `- **描述**: ${desc}\n` : ''}${steps ? `- **复现**: ${steps}\n` : ''}${expected ? `- **期望**: ${expected}\n` : ''}${actual ? `- **实际**: ${actual}\n` : ''}\n---\n\n`);
}

function fix(args: string[]): void {
  const id = parseInt(args[0]);
  if (!id) { console.error('Usage: fix <id> [--cause ...] [--fix ...] [--checkpoint ...]'); return; }
  let cause = '', fixDesc = '', checkpoint = '';
  for (let i = 1; i < args.length; i += 2) {
    const v = args[i + 1] || '';
    if (args[i] === '--cause') cause = v;
    else if (args[i] === '--fix') fixDesc = v;
    else if (args[i] === '--checkpoint') checkpoint = v;
  }
  const ts = now();
  db.prepare(`
    UPDATE bugs SET status = 'fixed', root_cause = COALESCE(NULLIF(?, ''), root_cause),
    fix_description = COALESCE(NULLIF(?, ''), fix_description),
    fix_checkpoint = COALESCE(NULLIF(?, ''), fix_checkpoint),
    updated_at = ?, resolved_at = ? WHERE id = ?
  `).run(cause, fixDesc, checkpoint, ts, ts, id);
  const bug = db.prepare('SELECT title FROM bugs WHERE id = ?').get(id) as { title: string } | undefined;
  console.log(`BUG-${String(id).padStart(3, '0')} -> fixed`);
  appendLog(`## [${ts}] BUG-${String(id).padStart(3, '0')} -> fixed\n\n- **标题**: ${bug?.title || '?'}\n${cause ? `- **根因**: ${cause}\n` : ''}${fixDesc ? `- **修复**: ${fixDesc}\n` : ''}${checkpoint ? `- **检查点**: ${checkpoint}\n` : ''}\n---\n\n`);
}

function close(args: string[]): void {
  const id = parseInt(args[0]);
  if (!id) { console.error('Usage: close <id> [--status wontfix|deferred|verified]'); return; }
  let status = 'wontfix';
  for (let i = 1; i < args.length; i += 2) {
    if (args[i] === '--status') status = args[i + 1] || 'wontfix';
  }
  const ts = now();
  db.prepare('UPDATE bugs SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?').run(status, ts, ts, id);
  console.log(`BUG-${String(id).padStart(3, '0')} -> ${status}`);
  appendLog(`## [${ts}] BUG-${String(id).padStart(3, '0')} -> ${status}\n\n---\n\n`);
}

function list(args: string[]): void {
  let where = 'WHERE 1=1';
  const params: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const v = args[i + 1] || '';
    if (args[i] === '--status') { where += ' AND status = ?'; params.push(v); }
    else if (args[i] === '--component') { where += ' AND component = ?'; params.push(v); }
    else if (args[i] === '--severity') { where += ' AND severity = ?'; params.push(v); }
  }
  const rows = db.prepare(`SELECT * FROM bugs ${where} ORDER BY id DESC`).all(...params) as Array<Record<string, unknown>>;
  if (!rows.length) { console.log('No bugs found.'); return; }
  console.log(`${'ID'.padEnd(8)} | ${'Severity'.padEnd(5)} | ${'Status'.padEnd(10)} | ${'Component'.padEnd(15)} | Title`);
  console.log('-'.repeat(80));
  for (const b of rows) {
    console.log(`BUG-${String(b.id).padStart(3, '0')} | ${String(b.severity).padEnd(5)} | ${String(b.status).padEnd(10)} | ${String(b.component).padEnd(15)} | ${b.title}`);
  }
}

function get(args: string[]): void {
  const id = parseInt(args[0]);
  const bug = db.prepare('SELECT * FROM bugs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!bug) { console.log(`BUG-${id} not found`); return; }
  for (const [k, v] of Object.entries(bug)) {
    if (v) console.log(`  ${k}: ${v}`);
  }
}

function summary(): void {
  const total = (db.prepare('SELECT COUNT(*) as n FROM bugs').get() as { n: number }).n;
  console.log(`Total: ${total}\n`);
  console.log('By status:');
  for (const r of db.prepare('SELECT status, COUNT(*) as n FROM bugs GROUP BY status').all() as Array<{ status: string; n: number }>) {
    console.log(`  ${r.status}: ${r.n}`);
  }
  console.log('\nBy severity:');
  for (const r of db.prepare('SELECT severity, COUNT(*) as n FROM bugs GROUP BY severity').all() as Array<{ severity: string; n: number }>) {
    console.log(`  ${r.severity}: ${r.n}`);
  }
  console.log('\nBy component:');
  for (const r of db.prepare('SELECT component, COUNT(*) as n FROM bugs GROUP BY component').all() as Array<{ component: string; n: number }>) {
    console.log(`  ${r.component}: ${r.n}`);
  }
}

function exportReport(): void {
  const rows = db.prepare('SELECT * FROM bugs ORDER BY id DESC').all() as Array<Record<string, unknown>>;
  const lines = [
    '# Gaia-bot 缺陷跟踪报告',
    '',
    `生成时间：${now()}`,
    '',
  ];

  // Summary
  const total = rows.length;
  const byStatus: Record<string, number> = {};
  for (const b of rows) byStatus[b.status as string] = (byStatus[b.status as string] || 0) + 1;
  lines.push(`## 概览：共 ${total} 条`, '');
  lines.push('| 状态 | 数量 |', '|---|---|');
  for (const [s, n] of Object.entries(byStatus).sort()) lines.push(`| ${s} | ${n} |`);
  lines.push('');

  // Group by status
  const groups = [
    { title: '待处理缺陷', filter: (b: Record<string, unknown>) => ['open', 'in_progress'].includes(b.status as string) },
    { title: '已修复缺陷', filter: (b: Record<string, unknown>) => ['fixed', 'verified'].includes(b.status as string) },
    { title: '已关闭/延后', filter: (b: Record<string, unknown>) => ['wontfix', 'deferred'].includes(b.status as string) },
  ];
  for (const g of groups) {
    const filtered = rows.filter(g.filter);
    if (!filtered.length) continue;
    lines.push(`## ${g.title}`, '');
    for (const b of filtered) {
      lines.push(`### BUG-${String(b.id).padStart(3, '0')}: ${b.title}`, '');
      lines.push(`- **严重度**: ${b.severity}`);
      lines.push(`- **状态**: ${b.status}`);
      lines.push(`- **组件**: ${b.component}`);
      lines.push(`- **报告时间**: ${b.reported_at}`);
      if (b.resolved_at) lines.push(`- **解决时间**: ${b.resolved_at}`);
      if (b.tags) lines.push(`- **标签**: ${b.tags}`);
      lines.push('');
      if (b.description) lines.push(`**描述**: ${b.description}`, '');
      if (b.steps_to_reproduce) lines.push(`**复现步骤**: ${b.steps_to_reproduce}`, '');
      if (b.expected) lines.push(`**期望行为**: ${b.expected}`, '');
      if (b.actual) lines.push(`**实际行为**: ${b.actual}`, '');
      if (b.root_cause) lines.push(`**根因**: ${b.root_cause}`, '');
      if (b.fix_description) lines.push(`**修复方案**: ${b.fix_description}`, '');
      if (b.fix_checkpoint) lines.push(`**修复检查点**: ${b.fix_checkpoint}`, '');
      lines.push('---', '');
    }
  }

  writeFileSync(REPORT_PATH, lines.join('\n'), 'utf-8');
  console.log(`Report exported to ${REPORT_PATH}`);
}

// ── Main ──
const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'report': report(rest); break;
  case 'fix': fix(rest); break;
  case 'close': close(rest); break;
  case 'list': list(rest); break;
  case 'get': get(rest); break;
  case 'summary': summary(); break;
  case 'export': exportReport(); break;
  default:
    console.log(`Usage: bug-cli.ts {report|fix|close|list|get|summary|export} [args]
  report "title" -s P0|P1|P2|P3 -c component -d "desc" --steps "..." --expected "..." --actual "..."
  fix <id> --cause "..." --fix "..." --checkpoint "..."
  close <id> --status wontfix|deferred|verified
  list [--status open] [--component pipeline] [--severity P0]
  get <id>
  summary
  export`);
}
db.close();
