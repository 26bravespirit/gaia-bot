# Dashboard 升级设计方案

> 状态: DESIGN — 待确认后实施
> 日期: 2026-04-06

## 一、当前架构

```
localhost:3400  Control Center (launcher.cjs)  — 聚合两个 bot 的 PM2 状态
localhost:3456  gaia-bot Dashboard             — 单 bot 通道/记忆/路由管理
localhost:3457  persona-bot Dashboard          — 同上
```

**当前功能：**
- 双通道状态卡片（feishu + lark-bot-worker）
- 通道启用/停用切换
- 记忆系统数字概览（LTM/Bio/亲密度/心情）
- 路由规则编辑器
- 5 秒自动刷新

**问题：**
1. lark-bot-worker 通道已废弃，需要移除
2. 只有数字快照，没有时间序列
3. 没有日志流
4. 没有 Pipeline 性能可视化
5. Control Center 和单 bot Dashboard 信息重复
6. 不能发现新 bot，硬编码端口

---

## 二、清理：移除 lark-bot-worker

**涉及文件（两个项目都要改）：**

### gaia-dashboard.cjs

| 行号 | 内容 | 操作 |
|------|------|------|
| 36-43 | `lark: { label: 'Lark bot-worker', ... }` | 删除整个 lark 通道定义 |
| 59 | `upsert.run('channel_lark_enabled', 'false', now)` | 删除 |
| 60-63 | routing_rules 默认值含 `mention_lark_cli: 'lark'` | 简化为 `{ default: 'feishu' }` |
| 441 | HTML 标题 "双通道管理面板" | 改为 "管理面板" |
| 624 | URL match `feishu\|lark` | 改为只匹配 `feishu` |

### launcher.cjs

无 lark-bot-worker 引用，不需要改。

---

## 三、升级设计：统一 Dashboard

### 3.1 架构升级

**目标：** 合并 Control Center + 单 bot Dashboard 为一个统一页面。

```
localhost:3400  Gaia Control Center (升级版)
  ├─ /                    统一监控首页
  ├─ /bot/:name           单 bot 详情页
  ├─ /logs                实时日志流
  ├─ /api/pm2             PM2 进程状态
  ├─ /api/bot/:name       单 bot API (代理到各 bot 的 DB)
  └─ /api/logs/:name      日志流 (SSE)
```

单 bot Dashboard (3456/3457) 保留为 fallback，但主入口统一到 3400。

### 3.2 首页改版

```
┌──────────────────────────────────────────────────────────┐
│  Gaia Control Center                    [Auto-refresh 5s]│
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  gaia-bot        │  │  persona-bot     │              │
│  │  🟢 ONLINE       │  │  🟢 ONLINE       │              │
│  │  PID 66030       │  │  PID 67884       │              │
│  │  Uptime 2h 15m   │  │  Uptime 1h 30m   │              │
│  │  Mem 69MB CPU 0% │  │  Mem 68MB CPU 0% │              │
│  │  ↻ 0 restarts   │  │  ↻ 1 restart    │              │
│  │  [Details]       │  │  [Details]       │              │
│  └─────────────────┘  └─────────────────┘               │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Pipeline Performance (last 1h)                      ││
│  │  ┌─────────────────────────────────────────────┐    ││
│  │  │ avg latency: 4.2s  │ p95: 7.8s  │ msgs: 23 │    ││
│  │  │         ▁▃▅▇█▇▅▃▁▂▃▅▆▇▅▃▁                  │    ││
│  │  │  S1  S2  S3S4  S5  S5.5  S6                 │    ││
│  │  │  0.1  0.2  2.1   0.3  0.1  1.4  (avg sec)  │    ││
│  │  └─────────────────────────────────────────────┘    ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Memory System                                       ││
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐         ││
│  │  │  9 │ │ 59 │ │182 │ │0.91│ │1.00│ │0.92│         ││
│  │  │LTM │ │Bio │ │Talk│ │Intm│ │Mood│ │Batt│         ││
│  │  └────┘ └────┘ └────┘ └────┘ └────┘ └────┘         ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Live Log Stream                        [Filter: ALL]││
│  │  12:50:52 [info] S1: [GG Cui] 在吗                   ││
│  │  12:50:54 [info] S3S4: generated (gpt-5.1, len=28)   ││
│  │  12:50:56 [info] S6: sent (len=28)                   ││
│  │  12:50:56 [info] replied to [GG Cui]: 在啊...        ││
│  │  12:51:02 [warn] getUserName failed for ou_d224...    ││
│  │  ──────────────────────────────────────────────────── ││
│  │  [info] [warn] [error] [S1] [S3S4] [S5] [S6]       ││
│  └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

### 3.3 新增模块设计

#### A. Pipeline Performance

**数据来源：** bot 进程在每条消息处理完后，写一条 timing 记录到 SQLite。

```sql
CREATE TABLE pipeline_timings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  chat_id TEXT,
  sender_name TEXT,
  stage TEXT,          -- S1, S2, S3S4, S4.5, S4.6, S5, S5.5, S6
  duration_ms INTEGER,
  model TEXT,          -- gpt-5.1, degradation_template, etc
  timestamp INTEGER
);
```

**Dashboard 展示：**
- 瀑布图：每条消息的 S1→S6 各阶段耗时
- 时间序列：最近 1 小时的 avg/p95 延迟
- Stage 占比饼图：哪个 stage 最耗时

#### B. Live Log Stream

**数据来源：** 读取 winston 日志文件尾部，通过 SSE (Server-Sent Events) 推送到浏览器。

```
GET /api/logs/:botName?level=info,warn,error&stage=S1,S3S4
Content-Type: text/event-stream

data: {"ts":"12:50:52","level":"info","msg":"S1: [GG Cui] 在吗"}
data: {"ts":"12:50:54","level":"info","msg":"S3S4: generated (gpt-5.1, len=28)"}
```

**前端：**
- 实时滚动日志窗口
- 按 level 过滤（info/warn/error）
- 按 stage 过滤（S1/S2/S3S4/S5/S6）
- 按 bot 切换（gaia-bot / persona-bot）
- 最大保留 200 条，旧的自动清除

#### C. LLM 调用监控

**数据来源：** 从 pipeline_timings 的 S3S4 + S4.5 + S4.6 记录提取。

**展示：**
- 模型使用分布（gpt-5.1 vs gpt-5 vs degradation）
- 调用延迟时间序列
- 降级率趋势
- 后台提取 (S4.5/S4.6) vs 主路径 (S3S4) 并发时间重叠

#### D. 用户关系图

**数据来源：** users 表 + relationships 表

**展示：**
- 每个用户一行：名字、消息数、亲密度进度条、关系阶段 badge
- 亲密度变化趋势（需要在 relationships 表加 history）
- 活跃承诺列表（status=active 的 promise）

#### E. 错误聚合

**数据来源：** event_log 表 + winston 日志

**展示：**
- Error/Warn 计数器（最近 1h / 24h）
- 按类型分组：LLM timeout, subscribe exit, getUserName failed, prompt leak
- 点击展开具体错误详情

#### F. 进程自动发现

**当前：** 硬编码 gaia-bot (3456) 和 persona-bot (3457)
**升级：** 通过 PM2 API 自动发现所有 name 含 "bot" 或 "gaia" 的进程，动态生成卡片

```javascript
// 自动发现逻辑
const pm2List = getPm2Status();
const bots = pm2List.filter(p => 
  p.name.includes('bot') && !p.name.includes('dashboard')
);
```

---

## 四、实施优先级

| 阶段 | 内容 | 工作量 | 依赖 |
|------|------|--------|------|
| P0 | 移除 lark-bot-worker | 30min | 无 |
| P1 | Live Log Stream (SSE) | 2h | 无 |
| P1 | Pipeline Timing 数据采集 | 1h | 改 pipeline-runner |
| P2 | Pipeline 瀑布图可视化 | 2h | P1 timing 数据 |
| P2 | 用户关系表格 | 1h | 无 |
| P2 | 错误聚合面板 | 1h | 无 |
| P3 | LLM 调用监控图表 | 2h | P1 timing 数据 |
| P3 | 进程自动发现 | 30min | 无 |
| P3 | 合并 Control Center + Dashboard | 3h | P1-P2 完成 |

---

## 五、技术选型

| 模块 | 方案 | 原因 |
|------|------|------|
| 图表 | 纯 CSS + SVG inline | 零依赖，保持单文件架构 |
| 实时推送 | SSE (Server-Sent Events) | 比 WebSocket 简单，浏览器原生支持 |
| 日志读取 | fs.watch + readline | 监听 winston 日志文件变化 |
| 数据存储 | 复用 SQLite (persona.db) | 不引入新依赖 |
| 前端框架 | 无（vanilla JS） | 保持内联 HTML，单文件部署 |
