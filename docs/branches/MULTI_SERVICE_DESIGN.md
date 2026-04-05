# 多 Lark App 共存方案 — 基于 OpenClaw 架构优化

## 设计灵感

OpenClaw 的核心设计：**单进程 Gateway + 多 Channel Plugin + 多 Account**。一个进程管理所有通道连接，每个通道是一个 Plugin，每个 Plugin 支持多账号独立生命周期。

我们的约束不同于 OpenClaw：lark-cli 是外部二进制，不是 in-process 插件。每个 app 的 subscribe 是一个独立子进程。但 **单进程协调多子进程** 的模式完全适用。

## 现状问题

```
问题 1: gaia-bot 和 GGBot 共用 app cli_a9470826ebf9dcb2，互斥
问题 2: lark-bot-worker 用 launchd KeepAlive=true，kill 后自动复活
问题 3: 手动 launchctl unload 不可持续，重启/登录后 plist 重新加载
问题 4: 无重连机制，lark-cli subscribe 断开后整个 bot 退出
```

## 架构：单进程 + 多 App Channel Manager

```
gaia-bot (单进程)
│
├── ChannelManager                        ← 借鉴 OpenClaw server-channels.ts
│   │
│   ├── LarkChannel: app_a9470826ebf9dcb2 (feishu)
│   │   ├── subscribe child process (pid=1234)
│   │   ├── status: running
│   │   ├── reconnectAttempts: 0
│   │   └── config: { home: ~/.local/share/GGBot/home, chatFilter: [oc_xxx] }
│   │
│   ├── LarkChannel: app_a94023f9bcb89ed2 (lark)    ← 未来可扩展
│   │   ├── subscribe child process (pid=5678)
│   │   ├── status: running
│   │   └── config: { home: ~/.lark-cli, chatFilter: [] }
│   │
│   └── (更多 app...)
│
├── MessageRouter                          ← 借鉴 OpenClaw resolve-route.ts
│   ├── app_a947... + oc_xxx → Gaia persona
│   ├── app_a940... + oc_yyy → 另一个 persona (未来)
│   └── default → Gaia
│
├── Pipeline (S1→S6)
│
└── MemoryManager (per user, 跨 channel 共享)
```

### 与 OpenClaw 的对应关系

| OpenClaw 概念 | gaia-bot 对应 | 说明 |
|---|---|---|
| Gateway | gaia-bot 主进程 | 单进程控制平面 |
| Channel Plugin | LarkChannel | 每个 lark app 是一个 channel |
| Account | app ID + LARK_HOME | 每个 app 配置独立隔离 |
| startAccount() | subscribe() 子进程 | 长生命周期，监听消息 |
| AbortSignal | AbortController | 优雅取消子进程 |
| ChannelManager | ChannelManager | 统一管理所有 channel 生命周期 |
| Bindings | MessageRouter | 路由消息到对应 persona |
| Session | Memory per user | 会话状态按用户隔离 |

## 核心模块设计

### 1. ChannelManager

```typescript
// src/lark/channel-manager.ts

interface LarkChannelConfig {
  appId: string;
  larkHome: string;          // lark-cli HOME 隔离
  larkBinary?: string;
  eventTypes?: string[];
  chatFilter?: string[];     // 只接收这些 chat 的消息
  personaConfig?: string;    // 指向哪个 persona.yaml
}

interface ChannelState {
  appId: string;
  status: 'stopped' | 'starting' | 'running' | 'reconnecting' | 'error';
  subscribePid: number | null;
  reconnectAttempts: number;
  maxReconnectAttempts: number;  // 默认 10
  lastError: string | null;
  lastStartAt: number | null;
  lastStopAt: number | null;
}

class ChannelManager {
  // 启动所有配置的 channel
  async startAll(): Promise<void>;

  // 启动/停止单个 channel
  async startChannel(appId: string): Promise<void>;
  async stopChannel(appId: string): Promise<void>;

  // 获取所有 channel 状态快照
  getSnapshot(): Map<string, ChannelState>;

  // 优雅关闭所有 channel
  async shutdown(): Promise<void>;
}
```

**生命周期管理**（借鉴 OpenClaw）：

```
启动流程:
1. 检查 lark-cli 原生锁文件 <LARK_HOME>/.lark-cli/locks/
2. 检查是否有外部进程（launchd worker）占用同一 app ID
   - 有且是 launchd → launchctl bootout（不是 kill）
   - 有且是普通进程 → SIGTERM
3. spawn lark-cli subscribe
4. 监听 stderr 2 秒，检测 "another instance" 错误
5. 成功 → status = running
6. 失败 → 进入重连

重连机制（指数退避）:
- 初始延迟: 5s
- 最大延迟: 5min
- 倍率: 2x
- 最大重试: 10 次
- 手动 stop 后不自动重连

关闭流程:
1. 标记 status = stopped（阻止自动重连）
2. SIGTERM → 等 5 秒 → SIGKILL
3. 清理锁文件
```

### 2. LarkChannel

```typescript
// src/lark/lark-channel.ts

class LarkChannel {
  private config: LarkChannelConfig;
  private state: ChannelState;
  private proc: ChildProcess | null;
  private abortController: AbortController;

  // 消息回调 — 收到消息时通知 ChannelManager
  onMessage: (msg: LarkMessage, appId: string) => void;

  async start(): Promise<void>;
  async stop(): Promise<void>;

  // 发消息（通过对应 app 的 lark-cli）
  sendText(chatId: string, text: string): string | null;
}
```

每个 LarkChannel 实例封装一个 lark-cli 子进程，通过 `LARK_HOME` 环境变量隔离 app 配置。不同 app 的 subscribe 进程互不影响。

### 3. MessageRouter

```typescript
// src/lark/message-router.ts

interface RouteBinding {
  appId: string;
  chatId?: string;       // 可选，不填则匹配该 app 所有 chat
  personaConfig: string;  // persona.yaml 路径
}

class MessageRouter {
  // 根据消息来源匹配 persona
  resolve(appId: string, chatId: string): RouteBinding | null;
}
```

当前阶段只有一个 app + 一个 persona，路由是透传的。但架构预留了多 app → 多 persona 的能力。

### 4. 外部服务冲突处理

```typescript
// src/lark/conflict-resolver.ts

class ConflictResolver {
  // 检测并解决特定 app ID 的冲突
  async resolve(appId: string, larkHome: string): Promise<boolean>;
}
```

**检测逻辑**：
1. 读 lark-cli 锁文件 `<LARK_HOME>/.lark-cli/locks/subscribe_*.lock`
2. 从锁文件提取 PID，检查进程是否存活
3. 存活 → 追溯父进程判断类型：
   - 父进程是 launchd → 查 `launchctl list` 找到 plist label → `launchctl bootout`
   - 父进程是 node/python → SIGTERM
   - 已死但锁文件残留 → 直接删除锁文件

**为什么不用 --force**：
`--force` 会终止现有 subscriber 但不停止其父进程。如果父进程是 launchd KeepAlive 服务，它会立即 respawn 新的 subscribe，形成"抢夺循环"。必须从 launchd 层面 bootout。

## 配置文件变更

### .env 增加

```env
# 服务标识
SERVICE_NAME=gaia-bot

# 多 app 配置（JSON）
LARK_CHANNELS=[{"appId":"cli_a9470826ebf9dcb2","larkHome":"/Users/shiyangcui/.local/share/GGBot/home","chatFilter":["oc_4600984a60e6dfea595b886f5c876104"]}]
```

单 app 场景下，保持现有 `LARK_HOME` + `TARGET_CHAT_ID` 向后兼容。`LARK_CHANNELS` 是可选的高级配置，不设置时自动从旧配置构建单 channel。

## 进程管理：pm2

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'gaia-bot',
    script: 'dist/index.js',
    cwd: __dirname,
    max_restarts: 5,
    restart_delay: 5000,
    kill_timeout: 10000,
    env: {
      NODE_ENV: 'production',
      SERVICE_NAME: 'gaia-bot',
      PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
    }
  }]
};
```

pm2 只管 gaia-bot 主进程。lark-cli subscribe 子进程的重连由 ChannelManager 内部处理。

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lark/lark-channel.ts` | 新增 | 单 app 连接封装，替代原 lark-client.ts 的 subscribe 部分 |
| `src/lark/channel-manager.ts` | 新增 | 多 channel 生命周期管理 |
| `src/lark/conflict-resolver.ts` | 新增 | launchd/进程冲突检测与解决 |
| `src/lark/message-router.ts` | 新增 | 消息路由（当前透传，预留多 persona） |
| `src/lark/lark-client.ts` | 修改 | 保留 sendText/sendCard/replyText，移除 subscribe 到 lark-channel |
| `src/index.ts` | 修改 | 用 ChannelManager 替换裸 subscribe，优化关闭逻辑 |
| `ecosystem.config.cjs` | 新增 | pm2 配置 |
| `.env` | 修改 | 增加 SERVICE_NAME，可选 LARK_CHANNELS |
| `package.json` | 修改 | 增加 pm2 scripts |

## 与原方案对比

| 维度 | 原方案（注册表互斥） | 新方案（ChannelManager） |
|---|---|---|
| 多 app 并行 | 支持，通过注册表协调 | 支持，单进程内并行管理 |
| 架构复杂度 | 多进程 + 共享文件 + 原子写入 | 单进程内协调，无跨进程文件锁 |
| 冲突处理 | 读注册表判断 | 直接检查锁文件 + 追溯父进程 |
| 重连机制 | 无（进程退出靠 pm2 重启） | 内置指数退避重连 |
| 扩展性 | 每个新 app 需要独立进程 | 新 app 只需加一条配置 |
| 参考来源 | 自研 | OpenClaw ChannelManager 模式 |

## 实施优先级

1. **P0**: LarkChannel + ChannelManager + ConflictResolver（核心生命周期）
2. **P1**: 修改 index.ts 接入 ChannelManager
3. **P2**: pm2 配置 + package.json scripts
4. **P3**: MessageRouter（当前透传，未来多 persona 时激活）
