# Gaia-Bot

> 人格驱动的飞书/Lark 聊天机器人框架
>
> 让你的 bot 拥有独立人格、长期记忆、情绪变化，像真人一样聊天

## 特性

- 🧠 8 阶段处理管道 — 从消息接收到拟人化回复（含消息合并、引用拉取、Thread 回复）
- 💾 多层记忆系统 — 即时/工作/长期/传记/关系五层记忆
- 😊 动态情绪 — 心情随时间和对话变化，影响回复风格
- 🛡️ 反 AI 检测 — 8 维指纹分析 + 6 条行为规则，不像 AI
- 🔍 搜索与网页读取 — Tavily API 搜索 + URL 内容提取，LLM tool_use 驱动
- 🔧 热配置 — persona.yaml 修改即生效，无需重启
- 📊 Control Center — localhost:3400 PM2 管理 + 主动发言开关 + 定时关闭
- 🔄 PM2 进程管理 — 自动重启 + macOS launchd 开机自启

## 快速开始

```bash
git clone https://github.com/26bravespirit/gaia-bot.git
cd gaia-bot
pnpm install
cp .env.example .env
# 编辑 .env 填入你的配置（见下方引导）
pnpm build && pnpm start
```

使用 Claude Code 打开项目，输入 `/setup` 启动交互式初始化向导。

## 初始化引导

1. **安装前置**: Node.js 20+, pnpm, lark-cli
2. **创建 Persona**: 回答 5 个问题自动生成 persona.yaml
3. **配置飞书**: 创建应用 → 登录 CLI → 获取 Chat ID
4. **设置环境变量**: 编辑 `.env` 文件
5. **构建启动**: `pnpm build && pnpm start`

详细交互式引导请参考 [SKILL.md](./SKILL.md)。

## 架构

```
用户消息 (飞书/Lark)
    │
    ▼
┌─ S1 消息调度 ──────────────────────────────┐
│  去重、@检测、空消息过滤                      │
└────────────────────────────────────────────┘
    │
    ▼
┌─ S2 上下文组装 ────────────────────────────┐
│  加载用户档案、对话历史、长期记忆、关系状态    │
│  检测情绪、更新自我状态                       │
└────────────────────────────────────────────┘
    │
    ▼
┌─ S3+S4 认知生成 ───────────────────────────┐
│  LLM 回复生成 + Tool Loop (≤3轮)            │
│  web_search / read_url + 人类行为概率注入     │
│  降级模板兜底                                │
└────────────────────────────────────────────┘
    │
    ├─→ S4.5 传记提取 (异步批量)
    ├─→ S4.6 记忆提取 (异步批量)  ← ExtractionScheduler 协调
    │
    ▼
┌─ S5 感知包装 ──────────────────────────────┐
│  R01-R06 反 AI 规则 → 记忆模糊 → 不完美注入  │
└────────────────────────────────────────────┘
    │
    ▼
┌─ S5.5 Anti-AI 校验 ───────────────────────┐
│  8 维指纹检测 → 评分 → PASS/WARN/BLOCK       │
└────────────────────────────────────────────┘
    │
    ▼
┌─ S6 出站调度 ──────────────────────────────┐
│  段落拆分 → 打字延迟 → Thread/主聊天发送      │
└────────────────────────────────────────────┘
```

## 目录结构

```
gaia-bot/
├── src/
│   ├── pipeline/     # 8 个管道阶段 + 提取调度器
│   ├── memory/       # 5 层记忆系统
│   ├── engine/       # 时间引擎、身份守卫、事件总线、消息合并器
│   ├── llm/          # LLM 客户端 (tool_use) + Prompt 构建器
│   ├── tools/        # 搜索 (Tavily) + 网页读取 (html-to-text)
│   ├── lark/         # 飞书通道管理
│   ├── config/       # 配置 Schema + YAML 加载
│   └── utils/        # 日志、环境、PID 锁
├── tests/            # 292 个测试
├── scripts/          # Control Center + CLI 工具
├── persona.yaml      # 人格定义（可热加载）
├── .env.example      # 环境变量模板
└── SKILL.md          # 交互式初始化向导
```

## 配置参考

`persona.yaml` 顶层配置节：

| 节 | 说明 |
|---|---|
| meta | 名字、描述、作者 |
| identity | 年龄、性格(Big Five)、身份边界 |
| knowledge | 擅长/熟悉/不了解的领域 |
| language | 说话风格、口语程度、口头禅 |
| temporal | 活跃时间、能量周期 |
| social | 关系阶段(陌生→亲密) |
| memory | 记忆重要性权重、遗忘机制 |
| biography | 人生经历锚点 |
| human_behaviors | 反问/困惑/选择性忽略概率 |
| anti_ai | 反 AI 检测开关和严格度 |

## 工具脚本

```bash
# PM2 进程管理
pm2 start ecosystem.config.cjs   # 启动
pm2 stop/restart gaia-bot         # 停止/重启

# Control Center (PM2 管理 + 主动发言 + 定时关闭)
pm2 start scripts/launcher.cjs --name control-center  # → http://localhost:3400

# 查看记忆系统
node scripts/inspect-memory.cjs all|ltm|rel|bio|self|conv

# 通道控制
node scripts/gaia-ctl.cjs status|on|off|routing
```

## 测试

```bash
pnpm test           # 运行全部 292 个测试
pnpm test:watch     # 监听模式
pnpm typecheck      # 类型检查
```

## 设计文档

详细的架构设计文档在 [gaia-design](https://github.com/26bravespirit/gaia-design) 仓库：

- 架构设计 v3.1 → v5
- MVP 开发文档 (MVP-00 ~ MVP-06)
- 攻击测试报告
- Bug 追踪日志

## License

MIT
