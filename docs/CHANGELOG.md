# Gaia-Bot Changelog

## 2026-04-06 — Conversation Quality Optimizations

基于实际会话分析，实施 7 项优化 + 1 项 bug fix。

### New Features
- **P0-1: 扩展消息类型解析** — `extractPostText()` / `extractCardText()` 支持富文本、卡片、图片、文件、表情包
- **P0-2: 非文本消息提示** — S1 对 image/sticker/file 等合成描述文本而非静默跳过
- **P0-3: 能力边界声明** — prompt 声明不能定时发消息、不能调研、不能访问链接
- **P1-1: 对话者角色定义** — `known_contacts` schema，prompt 注入身份防止误判职级
- **P1-2: 活跃承诺每轮注入** — promise 类型记忆每轮注入，不依赖 keyword 匹配
- **P2-1: 承诺状态管理** — long_term_memories 增加 status 字段 (active/overridden/fulfilled)
- **P3-1: Proactive 承诺跟进** — 静默 2 小时后主动提及未兑现承诺

### Bug Fixes
- **constraints.yaml YAML 语法** — 中文引号嵌套导致解析失败，改用方括号

### Tests
- UAT 171/171 ALL PASS
- 测试断言适配 Cathie Qian 人设

---

## 2026-04-05 — Initial Setup + Bug Fixes

### Setup
- 初始化向导 /setup 完成 7/7 步
- Persona: Cathie Qian (25岁, 双鱼座 ESFP, 港中大金融, 前汇丰→Sweetbanks)
- lark-cli: brand=lark, 已配置
- 模型: gpt-5.1 primary, gpt-5 fallback
- /setup-deploy: 本地运行，无云端部署

### Bug Fixes (10项)
1. **LARK_HOME 路径错误** — 应设为用户 home 目录，不是 ~/.lark-cli
2. **persona.yaml Zod 校验** — punctuation_style 只接受 sparse/normal/excessive; active_hours.end 最大 23
3. **多 Chat ID 支持** — TARGET_CHAT_ID 支持逗号分隔
4. **用户名解析** — getUserName() 三级查找 + chat member list fallback
5. **R00 Prompt Leak Sanitizer** — 过滤 LLM 泄露的【】标记和英文指令
6. **传记关键词扩充** — 加入学历/大学/学校/毕业等触发词
7. **公开信息不受亲密度限制** — 学历/职业/兴趣始终可分享
8. **Sleep mode 混入遗忘表达** — getSleepResponse() 不再 concat forgetting_expression
9. **Sleep mode 关闭** — bot 24小时正常回复
10. **Memory blur 短回复保护** — <30字不触发 blur; sleep_mode 跳过 S5
