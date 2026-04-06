# Gaia-Bot Defect Registry

## Status Legend
- FIXED — 已修复并通过测试
- OPEN — 已知问题待修复
- WONTFIX — 不修复

---

## FIXED

### DEF-001: LARK_HOME 路径错误
- **日期:** 2026-04-05
- **严重度:** P0
- **文件:** `.env`
- **根因:** LARK_HOME 应设为用户 home 目录，lark-channel.ts:71 把 HOME=LARK_HOME
- **修复:** LARK_HOME 设为用户 home 目录

### DEF-002: persona.yaml Zod 校验失败
- **日期:** 2026-04-05
- **严重度:** P0
- **文件:** persona.yaml
- **根因:** punctuation_style 只接受 sparse/normal/excessive; active_hours.end 最大 23
- **修复:** 使用合法枚举值

### DEF-003: 多 Chat ID 不支持
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/lark/channel-manager.ts:161`
- **修复:** TARGET_CHAT_ID 支持逗号分隔 split(',')

### DEF-004: 用户名查不到
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/lark/lark-client.ts` + `src/index.ts`
- **根因:** Lark 事件不带 senderName; contact API 需要权限
- **修复:** getUserName() 三级查找: 事件→SQLite缓存→chat member list

### DEF-005: LLM 泄露系统提示
- **日期:** 2026-04-05
- **严重度:** P0
- **文件:** `src/pipeline/s5-perception-wrapper.ts`
- **现象:** 回复包含"analysis to=final code omitted"和【】标记
- **修复:** R00 Prompt Leak Sanitizer

### DEF-006: 问学历不触发传记记忆
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/pipeline/s3s4-cognitive-generator.ts:93`
- **修复:** biographyKeywords 加入 学历|大学|学校|读书|毕业|专业 等

### DEF-007: 学历被亲密度限制
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/llm/prompt-builder.ts`
- **修复:** 公开信息不受 self_disclosure 限制

### DEF-008: Sleep mode 混入遗忘表达
- **日期:** 2026-04-05
- **严重度:** P0 (严重)
- **文件:** `src/engine/time-engine.ts:108-109`
- **根因:** getSleepResponse() concat forgetting_expression，57%概率回复"记不清"
- **修复:** sleep 回复只用 SLEEP_RESPONSES_DEFAULT

### DEF-009: Sleep mode 关闭
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/pipeline/s2-context-assembler.ts:94-103`
- **修复:** 注释掉 sleep mode 判断

### DEF-010: Memory blur 破坏短回复
- **日期:** 2026-04-05
- **严重度:** P1
- **文件:** `src/pipeline/s5-perception-wrapper.ts`
- **修复:** <30字不触发; sleep_mode 跳过 S5

### DEF-011: LLM 默认用户是老板
- **日期:** 2026-04-06
- **严重度:** P1
- **文件:** `src/llm/prompt-builder.ts` + `src/config/schemas.ts`
- **根因:** 无对话者角色信息，LLM 从指令语气猜测
- **修复:** known_contacts 角色定义 + 未知用户默认平等对话

### DEF-012: 看不到转发消息
- **日期:** 2026-04-06
- **严重度:** P0
- **文件:** `src/lark/lark-client.ts`
- **根因:** extractLarkMessage 只提取 content.text，忽略 post/card/sticker
- **修复:** extractPostText() + extractCardText() + 非文本类型合成

### DEF-013: LLM 承诺"晚点给你"但无法兑现
- **日期:** 2026-04-06
- **严重度:** P0
- **文件:** `src/config/parameter-interpreter.ts`
- **修复:** boundaryBlock 声明能力边界

### DEF-014: 承诺不是每轮注入
- **日期:** 2026-04-06
- **严重度:** P1
- **文件:** `src/pipeline/s2-context-assembler.ts`
- **根因:** promise 依赖 keyword 匹配才注入，可能被遗忘
- **修复:** getActivePromises() 每轮注入

### DEF-015: constraints.yaml YAML 语法错误
- **日期:** 2026-04-06
- **严重度:** P0
- **文件:** `src/config/constraints.yaml`
- **根因:** 中文引号嵌套在 YAML 双引号内
- **修复:** 改用方括号 [承诺]

---

## OPEN

### DEF-O01: Catchphrase 注入破坏语义
- **严重度:** P2
- **文件:** `src/pipeline/s5-perception-wrapper.ts` Step 3
- **现象:** 口头禅在随机位置硬塞，短回复时尤其明显
- **建议:** 只在句子边界且长度 >40 字时注入

### DEF-O02: persona-bot 未同步全部修复
- **严重度:** P1
- **路径:** persona-bot 项目（独立仓库）
- **已修:** #8 sleep mode + #4 用户名解析
- **未修:** R00, 传记关键词, 公开信息, blur保护, 消息类型, 角色定义, 承诺管理
