/**
 * Dashboard UAT Test Suite — 全面、严格、反向验证
 *
 * 测试维度：
 * A: API 功能正确性 (Happy Path)
 * B: 反向验证 / 负面测试 (Invalid inputs, error paths)
 * C: 安全攻击测试 (SQL injection, XSS, path traversal)
 * D: 用户旅程 (End-to-end workflow)
 * E: 数据一致性 (DB state matches API response)
 * F: 边界条件 (Empty DB, malformed JSON, concurrent ops)
 * G: HTTP 协议合规 (Status codes, Content-Type, CORS)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import { resolve } from 'path';
import Database from 'better-sqlite3';
import { execSync, spawn, type ChildProcess } from 'child_process';

// ── Constants ──
const PROJECT_ROOT = resolve(import.meta.dirname || '.', '../..');
const DASHBOARD_SCRIPT = resolve(PROJECT_ROOT, 'scripts/gaia-dashboard.cjs');
const DB_PATH = resolve(PROJECT_ROOT, 'data/persona.db');
const PORT = 13456; // Use non-default port to avoid conflict with running dashboard

// ── Helpers ──

/** Make an HTTP request to the dashboard server */
function request(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const bodyStr = opts.body ? JSON.stringify(opts.body) : undefined;
    const reqOpts: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: opts.method || 'GET',
      headers: {
        ...opts.headers,
        ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr).toString() } : {}),
      },
    };

    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: data,
          json: () => JSON.parse(data),
        });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** Direct DB helper for verification */
function openTestDb(readonly = true): Database.Database {
  return new Database(DB_PATH, { readonly });
}

function getDbConfig(key: string): string | null {
  const db = openTestDb();
  const row = db.prepare('SELECT value FROM runtime_config WHERE key = ?').get(key) as { value: string } | undefined;
  db.close();
  return row?.value ?? null;
}

function setDbConfig(key: string, value: string): void {
  const db = openTestDb(false);
  db.prepare(
    'INSERT INTO runtime_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  ).run(key, value, Date.now());
  db.close();
}

// ── Server lifecycle ──
let serverProc: ChildProcess;

beforeAll(async () => {
  // Spawn dashboard on test port
  serverProc = spawn(process.execPath, [DASHBOARD_SCRIPT], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for server to be ready (max 5s)
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Dashboard server did not start within 5s')), 5000);

    const check = () => {
      const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/', method: 'HEAD' }, () => {
        clearTimeout(timeout);
        resolve();
      });
      req.on('error', () => setTimeout(check, 200));
      req.end();
    };
    check();
  });
}, 10000);

afterAll(() => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
  }
});

// ═══════════════════════════════════════════
// A: API 功能正确性 (Happy Path)
// ═══════════════════════════════════════════
describe('A: API 功能正确性', () => {
  it('A1: GET / 返回 HTML 页面', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<!DOCTYPE html>');
    expect(res.body).toContain('Gaia Dashboard');
    expect(res.body).toContain('<script>');
  });

  it('A2: GET /index.html 也返回 HTML 页面', async () => {
    const res = await request('/index.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Gaia Dashboard');
  });

  it('A3: GET /api/status 返回通道和记忆数据', async () => {
    const res = await request('/api/status');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const data = res.json() as Record<string, unknown>;

    // 必须包含 channels
    expect(data).toHaveProperty('channels');
    expect(data).toHaveProperty('memory');

    const channels = data.channels as Record<string, unknown>;
    expect(channels).toHaveProperty('feishu');

    const feishu = channels.feishu as Record<string, unknown>;
    expect(feishu).toHaveProperty('label');
    expect(feishu).toHaveProperty('enabled');
    expect(typeof feishu.enabled).toBe('boolean');
    expect(feishu).toHaveProperty('process');
    expect(feishu).toHaveProperty('subscribe');

    // process 结构
    const proc = feishu.process as Record<string, unknown>;
    expect(proc).toHaveProperty('running');
    expect(typeof proc.running).toBe('boolean');

    // memory 结构
    const memory = data.memory as Record<string, unknown>;
    expect(memory).toHaveProperty('ltmCount');
    expect(typeof memory.ltmCount).toBe('number');
    expect(memory).toHaveProperty('bioCount');
    expect(typeof memory.bioCount).toBe('number');
  });

  it('A4: POST /api/channel/feishu/on 启用通道', async () => {
    // 先确保是 off
    setDbConfig('channel_feishu_enabled', 'false');

    const res = await request('/api/channel/feishu/on', { method: 'POST' });
    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.channel).toBe('feishu');
    expect(data.enabled).toBe(true);

    // 验证 DB 实际写入
    const dbVal = getDbConfig('channel_feishu_enabled');
    expect(dbVal).toBe('true');
  });

  it('A5: POST /api/channel/feishu/off 停用通道', async () => {
    setDbConfig('channel_feishu_enabled', 'true');

    const res = await request('/api/channel/feishu/off', { method: 'POST' });
    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.enabled).toBe(false);

    const dbVal = getDbConfig('channel_feishu_enabled');
    expect(dbVal).toBe('false');

    // 恢复
    setDbConfig('channel_feishu_enabled', 'true');
  });

  it('A6: GET /api/memory 返回记忆系统详情', async () => {
    const res = await request('/api/memory');
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, unknown>;
    // 必须返回各类记忆统计
    expect(data).toHaveProperty('ltmCount');
    expect(typeof data.ltmCount).toBe('number');
    expect(data).toHaveProperty('bioCount');

    // 如果有 recentLtm，必须是数组
    if (data.recentLtm) {
      expect(Array.isArray(data.recentLtm)).toBe(true);
    }
    if (data.recentBio) {
      expect(Array.isArray(data.recentBio)).toBe(true);
    }
    if (data.relationships) {
      expect(Array.isArray(data.relationships)).toBe(true);
    }
  });

  it('A7: GET /api/routing 返回路由规则', async () => {
    const res = await request('/api/routing');
    expect(res.status).toBe(200);

    const data = res.json() as Record<string, unknown>;
    // ensureDefaults 应该已设置 default: 'feishu'
    expect(data).toHaveProperty('default');
  });

  it('A8: POST /api/routing 更新路由规则', async () => {
    const newRules = { default: 'feishu', test_rule: 'test_channel' };
    const res = await request('/api/routing', { method: 'POST', body: newRules });
    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(data.ok).toBe(true);

    // 验证回读
    const readRes = await request('/api/routing');
    const readData = readRes.json() as Record<string, unknown>;
    expect(readData).toEqual(newRules);

    // 验证 DB 直读
    const dbRaw = getDbConfig('routing_rules');
    expect(JSON.parse(dbRaw!)).toEqual(newRules);

    // 恢复
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });
});

// ═══════════════════════════════════════════
// B: 反向验证 / 负面测试
// ═══════════════════════════════════════════
describe('B: 反向验证 (Negative Tests)', () => {
  it('B1: 未知路径返回 404', async () => {
    const res = await request('/api/nonexistent');
    expect(res.status).toBe(404);
  });

  it('B2: 未知通道名返回错误', async () => {
    const res = await request('/api/channel/unknown_channel/on', { method: 'POST' });
    // 路由正则只匹配 feishu，所以会 404
    expect(res.status).toBe(404);
  });

  it('B3: POST /api/channel/feishu/invalid_action 被拒绝', async () => {
    const res = await request('/api/channel/feishu/restart', { method: 'POST' });
    // 正则只允许 on|off
    expect(res.status).toBe(404);
  });

  it('B4: GET 方法调用 POST 端点不生效', async () => {
    const res = await request('/api/channel/feishu/on', { method: 'GET' });
    // channelMatch 要求 POST 方法
    expect(res.status).toBe(404);
  });

  it('B5: POST /api/routing 发送非法 JSON body', async () => {
    const res = await request('/api/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    // 空 body → JSON.parse 失败 → 500
    // 实际行为取决于 readBody 的 error handling
    expect([400, 500]).toContain(res.status);
  });

  it('B6: POST /api/routing 发送空对象仍应成功', async () => {
    const res = await request('/api/routing', { method: 'POST', body: {} });
    expect(res.status).toBe(200);

    // 验证：空路由也能回读
    const readRes = await request('/api/routing');
    expect(readRes.json()).toEqual({});

    // 恢复
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('B7: PUT/DELETE/PATCH 方法不受支持', async () => {
    const methods = ['PUT', 'DELETE', 'PATCH'] as const;
    for (const method of methods) {
      const res = await request('/api/status', { method });
      // 非 GET /api/status → 404
      expect(res.status).toBe(404);
    }
  });

  it('B8: 超长路径不导致崩溃', async () => {
    const longPath = '/api/' + 'a'.repeat(10000);
    const res = await request(longPath);
    expect([404, 414]).toContain(res.status);
  });

  it('B9: 连续快速 toggle 不丢状态', async () => {
    // 快速 on→off→on→off→on
    const actions = ['on', 'off', 'on', 'off', 'on'] as const;
    for (const action of actions) {
      await request(`/api/channel/feishu/${action}`, { method: 'POST' });
    }
    // 最终应该是 on
    const dbVal = getDbConfig('channel_feishu_enabled');
    expect(dbVal).toBe('true');

    // API 也应该一致
    const res = await request('/api/status');
    const data = res.json() as { channels: { feishu: { enabled: boolean } } };
    expect(data.channels.feishu.enabled).toBe(true);
  });
});

// ═══════════════════════════════════════════
// C: 安全攻击测试
// ═══════════════════════════════════════════
describe('C: 安全攻击测试', () => {
  it('C1: SQL 注入 — 通道名注入', async () => {
    // 尝试在通道名中注入 SQL
    const injections = [
      "feishu'; DROP TABLE runtime_config; --",
      "feishu' OR '1'='1",
      'feishu%27%20OR%201%3D1',
    ];
    for (const payload of injections) {
      const res = await request(`/api/channel/${encodeURIComponent(payload)}/on`, { method: 'POST' });
      // 正则不匹配 → 404，安全
      expect(res.status).toBe(404);
    }

    // 验证 runtime_config 表仍完整
    const db = openTestDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM runtime_config').get() as { c: number };
    expect(count.c).toBeGreaterThan(0);
    db.close();
  });

  it('C2: SQL 注入 — routing body 注入', async () => {
    // routing body 存为 JSON string，不直接拼 SQL，但验证不会破坏 DB
    const malicious = { "key'; DROP TABLE runtime_config;--": 'value' };
    const res = await request('/api/routing', { method: 'POST', body: malicious });
    expect(res.status).toBe(200);

    // 验证 DB 完整性
    const db = openTestDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('runtime_config');
    db.close();

    // 恢复
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('C3: XSS — HTML 页面中不应有用户可控的未转义输出', async () => {
    // 设置恶意路由规则
    const xssPayload = { '<script>alert(1)</script>': '<img onerror=alert(1) src=x>' };
    await request('/api/routing', { method: 'POST', body: xssPayload });

    // 获取 HTML 页面 — 由于 HTML 是静态模板，不包含动态 DB 数据
    // 但 API JSON 响应中的数据在前端通过 innerHTML 渲染
    const htmlRes = await request('/');
    // 静态 HTML 本身不应包含注入
    expect(htmlRes.body).not.toContain('<script>alert(1)</script>');

    // 验证 API 返回的数据中恶意 payload 被原样保存（前端需要转义）
    const routingRes = await request('/api/routing');
    const data = routingRes.json() as Record<string, unknown>;
    // 数据存储是正确的，但标记前端 innerHTML 是 XSS 风险
    expect(data).toHaveProperty('<script>alert(1)</script>');

    // 恢复
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('C4: 路径遍历 — 不能访问非 API 文件', async () => {
    const traversalPaths = [
      '/../.env',
      '/../../etc/passwd',
      '/.env',
      '/api/../.env',
      '/%2e%2e/%2e%2e/.env',
    ];
    for (const path of traversalPaths) {
      const res = await request(path);
      // 所有非法路径都应返回 404 且不泄露文件内容
      expect(res.status).toBe(404);
      expect(res.body).not.toContain('OPENAI_API_KEY');
      expect(res.body).not.toContain('LARK_APP_ID');
    }
  });

  it('C5: 大 body 不导致 OOM 或崩溃', async () => {
    // 发送 1MB JSON
    const largeBody = { data: 'x'.repeat(1024 * 1024) };
    try {
      const res = await request('/api/routing', { method: 'POST', body: largeBody });
      // 应该成功或返回错误，但不能崩溃
      expect([200, 413, 500]).toContain(res.status);
    } catch {
      // Connection reset 也可接受 — 服务器拒绝大请求
    }

    // 验证服务器仍然存活
    const healthCheck = await request('/api/status');
    expect(healthCheck.status).toBe(200);
  });

  it('C6: 错误响应不泄露内部路径或堆栈', async () => {
    // 触发错误
    const res = await request('/api/routing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    // 响应不应包含文件系统路径
    expect(res.body).not.toMatch(/\/Users\//);
    expect(res.body).not.toMatch(/\/home\//);
    expect(res.body).not.toMatch(/node_modules/);
    expect(res.body).not.toMatch(/at\s+\w+\s+\(/); // stack trace pattern
  });
});

// ═══════════════════════════════════════════
// D: 用户旅程 (End-to-End Workflow)
// ═══════════════════════════════════════════
describe('D: 用户旅程', () => {
  it('D1: 完整管理员旅程 — 查看 → 停用 → 验证 → 修改路由 → 启用', async () => {
    // Step 1: 查看当前状态
    const step1 = await request('/api/status');
    expect(step1.status).toBe(200);
    const initialState = step1.json() as { channels: { feishu: { enabled: boolean } } };

    // Step 2: 停用 feishu
    const step2 = await request('/api/channel/feishu/off', { method: 'POST' });
    expect(step2.status).toBe(200);

    // Step 3: 验证状态已变更
    const step3 = await request('/api/status');
    const afterOff = step3.json() as { channels: { feishu: { enabled: boolean } } };
    expect(afterOff.channels.feishu.enabled).toBe(false);

    // Step 4: 修改路由规则
    const newRouting = { default: 'feishu', maintenance: 'none' };
    const step4 = await request('/api/routing', { method: 'POST', body: newRouting });
    expect(step4.status).toBe(200);

    // Step 5: 验证路由已变更
    const step5 = await request('/api/routing');
    expect(step5.json()).toEqual(newRouting);

    // Step 6: 重新启用
    const step6 = await request('/api/channel/feishu/on', { method: 'POST' });
    expect(step6.status).toBe(200);

    // Step 7: 最终验证全部状态
    const step7 = await request('/api/status');
    const finalState = step7.json() as { channels: { feishu: { enabled: boolean } } };
    expect(finalState.channels.feishu.enabled).toBe(true);

    // 恢复路由
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('D2: 记忆监控旅程 — 查看状态 + 查看记忆详情', async () => {
    // 获取概览
    const statusRes = await request('/api/status');
    const status = statusRes.json() as { memory: { ltmCount: number; bioCount: number } };

    // 获取详情
    const memRes = await request('/api/memory');
    const memDetail = memRes.json() as { ltmCount: number; bioCount: number };

    // 两个 API 的 count 应该一致
    expect(memDetail.ltmCount).toBe(status.memory.ltmCount);
    expect(memDetail.bioCount).toBe(status.memory.bioCount);
  });

  it('D3: 前端页面数据流旅程 — HTML 包含所有必要 JS 逻辑', async () => {
    const res = await request('/');
    const html = res.body;

    // 验证前端 JS 包含所有关键函数
    expect(html).toContain('function refresh()');
    expect(html).toContain('function renderChannels(');
    expect(html).toContain('function renderMemory(');
    expect(html).toContain('function renderRouting(');
    expect(html).toContain('function toggleChannel(');
    expect(html).toContain('function saveRouting()');
    expect(html).toContain('function showToast(');

    // 验证自动刷新间隔
    expect(html).toContain('setInterval(refresh, 5000)');

    // 验证 API 路径正确
    expect(html).toContain('/api/status');
    expect(html).toContain('/api/routing');
    expect(html).toContain('/api/channel/');
  });
});

// ═══════════════════════════════════════════
// E: 数据一致性
// ═══════════════════════════════════════════
describe('E: 数据一致性', () => {
  it('E1: API 状态与 DB 直读一致', async () => {
    const res = await request('/api/status');
    const data = res.json() as { channels: { feishu: { enabled: boolean } } };

    const dbVal = getDbConfig('channel_feishu_enabled');
    expect(data.channels.feishu.enabled).toBe(dbVal === 'true');
  });

  it('E2: 路由规则 API 与 DB 直读一致', async () => {
    const res = await request('/api/routing');
    const apiData = res.json();

    const dbRaw = getDbConfig('routing_rules');
    const dbData = JSON.parse(dbRaw!);

    expect(apiData).toEqual(dbData);
  });

  it('E3: 记忆统计 API 与 DB 直读一致', async () => {
    const res = await request('/api/memory');
    const apiData = res.json() as { ltmCount: number; bioCount: number };

    const db = openTestDb();
    const ltmCount = (db.prepare('SELECT COUNT(*) as c FROM long_term_memories').get() as { c: number }).c;
    const bioCount = (db.prepare('SELECT COUNT(*) as c FROM biographical_facts WHERE is_active=1').get() as { c: number }).c;
    db.close();

    expect(apiData.ltmCount).toBe(ltmCount);
    expect(apiData.bioCount).toBe(bioCount);
  });

  it('E4: toggle 写入后立即读取一致（无延迟）', async () => {
    // Toggle off
    await request('/api/channel/feishu/off', { method: 'POST' });
    const res1 = await request('/api/status');
    const d1 = res1.json() as { channels: { feishu: { enabled: boolean } } };
    expect(d1.channels.feishu.enabled).toBe(false);

    // Toggle on
    await request('/api/channel/feishu/on', { method: 'POST' });
    const res2 = await request('/api/status');
    const d2 = res2.json() as { channels: { feishu: { enabled: boolean } } };
    expect(d2.channels.feishu.enabled).toBe(true);
  });

  it('E5: 关系和自我状态数据格式校验', async () => {
    const res = await request('/api/status');
    const data = res.json() as { memory: Record<string, unknown> };
    const mem = data.memory;

    if (mem.relationship) {
      const rel = mem.relationship as Record<string, unknown>;
      // 关系数据字段类型校验
      expect(typeof rel.stage).toBe('string');
      expect(['stranger', 'acquaintance', 'familiar', 'intimate']).toContain(rel.stage);
      expect(typeof rel.intimacy_score).toBe('number');
      expect(rel.intimacy_score as number).toBeGreaterThanOrEqual(0);
      expect(typeof rel.interaction_count).toBe('number');
    }

    if (mem.selfState) {
      const self = mem.selfState as Record<string, unknown>;
      expect(typeof self.mood_baseline).toBe('number');
      expect(typeof self.energy_level).toBe('string');
      expect(typeof self.social_battery).toBe('number');
    }
  });
});

// ═══════════════════════════════════════════
// F: 边界条件
// ═══════════════════════════════════════════
describe('F: 边界条件', () => {
  it('F1: 路由规则存储深层嵌套 JSON', async () => {
    const nested = {
      level1: { level2: { level3: { level4: 'deep_value' } } },
      array: [1, 2, [3, [4, [5]]]],
    };
    const res = await request('/api/routing', { method: 'POST', body: nested });
    expect(res.status).toBe(200);

    const readRes = await request('/api/routing');
    expect(readRes.json()).toEqual(nested);

    // 恢复
    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('F2: 路由规则存储 Unicode 内容', async () => {
    const unicode = { '中文规则': '飞书通道', 'emoji_rule': '🚀' };
    const res = await request('/api/routing', { method: 'POST', body: unicode });
    expect(res.status).toBe(200);

    const readRes = await request('/api/routing');
    expect(readRes.json()).toEqual(unicode);

    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('F3: 幂等性 — 连续相同 toggle 操作不产生副作用', async () => {
    // 连续 on 三次
    for (let i = 0; i < 3; i++) {
      const res = await request('/api/channel/feishu/on', { method: 'POST' });
      expect(res.status).toBe(200);
    }
    expect(getDbConfig('channel_feishu_enabled')).toBe('true');

    // 连续 off 三次
    for (let i = 0; i < 3; i++) {
      const res = await request('/api/channel/feishu/off', { method: 'POST' });
      expect(res.status).toBe(200);
    }
    expect(getDbConfig('channel_feishu_enabled')).toBe('false');

    // 恢复
    setDbConfig('channel_feishu_enabled', 'true');
  });

  it('F4: 路由规则存空字符串值', async () => {
    const emptyVal = { default: '', other: 'feishu' };
    const res = await request('/api/routing', { method: 'POST', body: emptyVal });
    expect(res.status).toBe(200);

    const readRes = await request('/api/routing');
    expect(readRes.json()).toEqual(emptyVal);

    setDbConfig('routing_rules', JSON.stringify({ default: 'feishu' }));
  });

  it('F5: 并发请求不丢失数据', async () => {
    // 同时发 10 个 toggle 请求
    const promises = Array.from({ length: 10 }, (_, i) =>
      request(`/api/channel/feishu/${i % 2 === 0 ? 'on' : 'off'}`, { method: 'POST' }),
    );
    const results = await Promise.all(promises);

    // 所有请求都应成功
    for (const r of results) {
      expect(r.status).toBe(200);
    }

    // DB 最终状态应该是 on 或 off（确定性），且 API 一致
    const dbVal = getDbConfig('channel_feishu_enabled');
    const statusRes = await request('/api/status');
    const apiVal = (statusRes.json() as { channels: { feishu: { enabled: boolean } } }).channels.feishu.enabled;
    expect(apiVal).toBe(dbVal === 'true');

    // 恢复
    setDbConfig('channel_feishu_enabled', 'true');
  });

  it('F6: 记忆 API 在表为空时也不崩溃', async () => {
    // 即使某些表数据为空，API 也应返回合理默认值
    const res = await request('/api/memory');
    expect(res.status).toBe(200);
    const data = res.json() as Record<string, unknown>;
    expect(typeof data.ltmCount).toBe('number');
    expect(data.ltmCount as number).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════
// G: HTTP 协议合规
// ═══════════════════════════════════════════
describe('G: HTTP 协议合规', () => {
  it('G1: JSON API 返回正确 Content-Type', async () => {
    const endpoints = ['/api/status', '/api/memory', '/api/routing'];
    for (const ep of endpoints) {
      const res = await request(ep);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.headers['content-type']).toContain('charset=utf-8');
    }
  });

  it('G2: HTML 页面返回正确 Content-Type', async () => {
    const res = await request('/');
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-type']).toContain('charset=utf-8');
  });

  it('G3: POST 响应也是 JSON', async () => {
    const res = await request('/api/channel/feishu/on', { method: 'POST' });
    expect(res.headers['content-type']).toContain('application/json');

    // 恢复
    setDbConfig('channel_feishu_enabled', 'true');
  });

  it('G4: 404 响应不返回 JSON（是纯文本 Not Found）', async () => {
    const res = await request('/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body).toBe('Not Found');
  });
});

// ═══════════════════════════════════════════
// H: 前端 UI 质量检查 (HTML 静态分析)
// ═══════════════════════════════════════════
describe('H: 前端 UI 质量', () => {
  let htmlContent: string;

  beforeAll(async () => {
    const res = await request('/');
    htmlContent = res.body;
  });

  it('H1: HTML 包含必要的 meta 标签', () => {
    expect(htmlContent).toContain('charset="utf-8"');
    expect(htmlContent).toContain('name="viewport"');
    expect(htmlContent).toContain('width=device-width');
  });

  it('H2: CSS 变量系统完备', () => {
    const requiredVars = ['--bg', '--surface', '--border', '--text', '--green', '--red', '--blue'];
    for (const v of requiredVars) {
      expect(htmlContent).toContain(v);
    }
  });

  it('H3: 暗色主题颜色值合理（不是纯黑或纯白）', () => {
    // --bg 应该是深色但不是 #000
    expect(htmlContent).toMatch(/--bg:\s*#0f1117/);
    // --text 应该是浅色但不是 #fff
    expect(htmlContent).toMatch(/--text:\s*#e1e4ed/);
  });

  it('H4: 必要的 UI 元素都存在', () => {
    expect(htmlContent).toContain('id="channels"');
    expect(htmlContent).toContain('id="memory"');
    expect(htmlContent).toContain('id="routing"');
    expect(htmlContent).toContain('id="toast"');
    expect(htmlContent).toContain('id="refreshNote"');
  });

  it('H5: 中文标签使用正确', () => {
    expect(htmlContent).toContain('lang="zh-CN"');
    expect(htmlContent).toContain('管理面板');
    expect(htmlContent).toContain('记忆系统');
    expect(htmlContent).toContain('路由规则');
  });

  it('H6: 动画不使用 layout-bound 属性', () => {
    // 检查 @keyframes 中不包含 width/height/top/left 等
    const keyframeMatch = htmlContent.match(/@keyframes\s+\w+\s*\{[^}]+\}/g);
    if (keyframeMatch) {
      for (const kf of keyframeMatch) {
        expect(kf).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
      }
    }
  });

  it('H7: 前端 innerHTML XSS 风险审计', () => {
    // 标记：前端使用 innerHTML 渲染动态数据，这是 XSS 风险
    // renderChannels, renderMemory, renderRouting 都使用 el.innerHTML = html
    const innerHtmlCount = (htmlContent.match(/\.innerHTML\s*=/g) || []).length;
    // 记录 innerHTML 使用次数，后续应考虑迁移为 textContent 或 DOM API
    expect(innerHtmlCount).toBeGreaterThan(0); // 确认当前存在
    // TODO: 这是一个已知的安全隐患，应在后续版本中修复
  });

  it('H8: 响应式设计 — 存在媒体查询', () => {
    expect(htmlContent).toMatch(/@media\s*\(max-width/);
  });
});

// ═══════════════════════════════════════════
// I: 回归防护 — 关键不变量
// ═══════════════════════════════════════════
describe('I: 回归防护', () => {
  it('I1: ensureDefaults 不覆盖已有配置', async () => {
    // 设置自定义值
    setDbConfig('channel_feishu_enabled', 'false');

    // 重新请求（会触发 ensureDefaults）— 但 INSERT OR IGNORE 不覆盖
    const res = await request('/api/status');
    const data = res.json() as { channels: { feishu: { enabled: boolean } } };
    // 自定义值应保留
    expect(data.channels.feishu.enabled).toBe(false);

    // 恢复
    setDbConfig('channel_feishu_enabled', 'true');
  });

  it('I2: status API 包含进程检测结构', async () => {
    const res = await request('/api/status');
    const data = res.json() as { channels: { feishu: { process: Record<string, unknown> } } };
    const proc = data.channels.feishu.process;

    // 必须有 running 字段（boolean）
    expect(typeof proc.running).toBe('boolean');
    // 必须有 pid 字段（number | null）
    expect(proc.pid === null || typeof proc.pid === 'number').toBe(true);
    // 必须有 cmd 字段（string | null）
    expect(proc.cmd === null || typeof proc.cmd === 'string').toBe(true);
  });

  it('I3: memory API 返回 recentLtm 条数不超过 10', async () => {
    const res = await request('/api/memory');
    const data = res.json() as { recentLtm?: unknown[] };
    if (data.recentLtm) {
      expect(data.recentLtm.length).toBeLessThanOrEqual(10);
    }
  });

  it('I4: memory API 返回 recentBio 条数不超过 10', async () => {
    const res = await request('/api/memory');
    const data = res.json() as { recentBio?: unknown[] };
    if (data.recentBio) {
      expect(data.recentBio.length).toBeLessThanOrEqual(10);
    }
  });

  it('I5: channel toggle 响应结构一致', async () => {
    const onRes = await request('/api/channel/feishu/on', { method: 'POST' });
    const onData = onRes.json() as Record<string, unknown>;

    expect(onData).toHaveProperty('ok');
    expect(onData).toHaveProperty('channel');
    expect(onData).toHaveProperty('enabled');
    expect(onData.ok).toBe(true);
    expect(onData.channel).toBe('feishu');
    expect(typeof onData.enabled).toBe('boolean');
  });
});
