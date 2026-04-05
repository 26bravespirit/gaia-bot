# Gaia-bot 缺陷跟踪报告

生成时间：2026-04-04 11:50:24

## 概览：共 8 条

| 状态 | 数量 |
|---|---|
| fixed | 8 |

## 已修复缺陷

### BUG-008: lark-cli配置路径不匹配

- **严重度**: P1
- **状态**: fixed
- **组件**: lark
- **报告时间**: 2026-04-04 11:50:17
- **解决时间**: 2026-04-04 11:50:17
- **标签**: 配置,lark-cli

**描述**: gaia-bot用默认HOME启动，但lark-cli config.json在GGBot隔离HOME下

**实际行为**: subscribe进程运行但无法收到消息

**根因**: lark-cli配置在~/.local/share/GGBot/home/.lark-cli/

**修复方案**: 启动时设置LARK_HOME指向该路径

**修复检查点**: v2_fix_home

---

### BUG-007: lark-cli subscribe参数--event-type(单数)错误

- **严重度**: P1
- **状态**: fixed
- **组件**: lark
- **报告时间**: 2026-04-04 11:50:16
- **解决时间**: 2026-04-04 11:50:16
- **标签**: lark-cli

**描述**: 应为--event-types(复数)加逗号分隔

**实际行为**: unknown flag: --event-type

**根因**: lark-cli参数是--event-types

**修复方案**: 改为--event-types加逗号拼接

**修复检查点**: v2_fix_eventtype

---

### BUG-006: lark-cli subscribe单实例冲突

- **严重度**: P1
- **状态**: fixed
- **组件**: lark
- **报告时间**: 2026-04-04 11:50:15
- **解决时间**: 2026-04-04 11:50:15
- **标签**: 启动,部署

**描述**: 其他launchd服务占用同一app的事件订阅

**实际行为**: another event +subscribe instance is already running

**根因**: com.shiyangcui.lark-bot-worker launchd服务自动重启占用subscribe

**修复方案**: 停掉所有旧launchd服务后再启动

**修复检查点**: v2_fix_subscribe

---

### BUG-005: OPENAI_API_KEY为空(HOME改变导致keychain不可达)

- **严重度**: P0
- **状态**: fixed
- **组件**: env
- **报告时间**: 2026-04-04 11:50:14
- **解决时间**: 2026-04-04 11:50:15
- **标签**: 启动,API,P0

**描述**: 启动时HOME设为lark-cli隔离目录，security命令找不到login keychain

**实际行为**: OPENAI_API_KEY is required，所有LLM调用失败

**根因**: shell展开顺序：HOME=x时security已在新HOME下运行

**修复方案**: 启动前用真实HOME获取key，再作为环境变量传入

**修复检查点**: v2_fix_apikey

---

### BUG-004: lark-cli命令格式错误(+messages-create)

- **严重度**: P0
- **状态**: fixed
- **组件**: lark
- **报告时间**: 2026-04-04 11:50:14
- **解决时间**: 2026-04-04 11:50:14
- **标签**: lark-cli,P0

**描述**: 使用+messages-create --receive-id-type而非+messages-send --chat-id

**复现步骤**: 1.收到消息 2.handler生成回复 3.send_text调用错误命令

**期望行为**: 消息发送到飞书

**实际行为**: unknown flag: --receive-id-type

**根因**: lark-cli正确命令是+messages-send --chat-id --text

**修复方案**: 重写lark-client.ts的sendText/replyText方法

**修复检查点**: v2_fix_lark

---

### BUG-003: test fixture base_delay_ms.max低于schema最小值

- **严重度**: P3
- **状态**: fixed
- **组件**: tests
- **报告时间**: 2026-04-04 11:50:13
- **解决时间**: 2026-04-04 11:50:13
- **标签**: 测试

**描述**: 测试用persona.yaml中max:200低于Zod schema定义的min:1000

**实际行为**: Zod校验报错: Number must be >= 1000

**根因**: test fixture值未对齐新schema约束

**修复方案**: 将test fixture的base_delay_ms.max改为1000

**修复检查点**: v2_fix_test

---

### BUG-002: meta.name引用错误导致Persona loaded: undefined

- **严重度**: P2
- **状态**: fixed
- **组件**: config
- **报告时间**: 2026-04-04 11:50:12
- **解决时间**: 2026-04-04 11:50:12
- **标签**: 重构

**描述**: index.ts和s6等文件引用config.identity.name，但新schema中name在config.meta.name

**实际行为**: 日志显示Persona loaded: undefined

**根因**: schema重构后未同步更新所有引用点

**修复方案**: 全局替换config.identity.name为config.meta.name

**修复检查点**: v2_fix_name_ref

---

### BUG-001: Zod schema不匹配MVP-02规范

- **严重度**: P1
- **状态**: fixed
- **组件**: config
- **报告时间**: 2026-04-04 11:50:11
- **解决时间**: 2026-04-04 11:50:12
- **标签**: schema,重构

**描述**: 初版schema使用旧字段结构(identity.name等)，不符合MVP-02规范(meta.name, identity.background等)

**实际行为**: persona.yaml加载失败或字段映射错误

**根因**: 初版按旧设计开发，未读取MVP-02规范

**修复方案**: 重写schemas.ts/parameter-interpreter.ts，完整实现MVP-02的version/meta/identity/knowledge/language/temporal/social/memory结构

**修复检查点**: v2_full_schema

---
