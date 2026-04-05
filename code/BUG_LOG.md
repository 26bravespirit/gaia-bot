# Gaia-bot Bug Log

## [2026-04-04 11:50:11] BUG-001 REPORTED

- **标题**: Zod schema不匹配MVP-02规范
- **严重度**: P1
- **组件**: config
- **描述**: 初版schema使用旧字段结构(identity.name等)，不符合MVP-02规范(meta.name, identity.background等)
- **实际**: persona.yaml加载失败或字段映射错误

---

## [2026-04-04 11:50:12] BUG-001 -> fixed

- **标题**: Zod schema不匹配MVP-02规范
- **根因**: 初版按旧设计开发，未读取MVP-02规范
- **修复**: 重写schemas.ts/parameter-interpreter.ts，完整实现MVP-02的version/meta/identity/knowledge/language/temporal/social/memory结构
- **检查点**: v2_full_schema

---

## [2026-04-04 11:50:12] BUG-002 REPORTED

- **标题**: meta.name引用错误导致Persona loaded: undefined
- **严重度**: P2
- **组件**: config
- **描述**: index.ts和s6等文件引用config.identity.name，但新schema中name在config.meta.name
- **实际**: 日志显示Persona loaded: undefined

---

## [2026-04-04 11:50:12] BUG-002 -> fixed

- **标题**: meta.name引用错误导致Persona loaded: undefined
- **根因**: schema重构后未同步更新所有引用点
- **修复**: 全局替换config.identity.name为config.meta.name
- **检查点**: v2_fix_name_ref

---

## [2026-04-04 11:50:13] BUG-003 REPORTED

- **标题**: test fixture base_delay_ms.max低于schema最小值
- **严重度**: P3
- **组件**: tests
- **描述**: 测试用persona.yaml中max:200低于Zod schema定义的min:1000
- **实际**: Zod校验报错: Number must be >= 1000

---

## [2026-04-04 11:50:13] BUG-003 -> fixed

- **标题**: test fixture base_delay_ms.max低于schema最小值
- **根因**: test fixture值未对齐新schema约束
- **修复**: 将test fixture的base_delay_ms.max改为1000
- **检查点**: v2_fix_test

---

## [2026-04-04 11:50:14] BUG-004 REPORTED

- **标题**: lark-cli命令格式错误(+messages-create)
- **严重度**: P0
- **组件**: lark
- **描述**: 使用+messages-create --receive-id-type而非+messages-send --chat-id
- **复现**: 1.收到消息 2.handler生成回复 3.send_text调用错误命令
- **期望**: 消息发送到飞书
- **实际**: unknown flag: --receive-id-type

---

## [2026-04-04 11:50:14] BUG-004 -> fixed

- **标题**: lark-cli命令格式错误(+messages-create)
- **根因**: lark-cli正确命令是+messages-send --chat-id --text
- **修复**: 重写lark-client.ts的sendText/replyText方法
- **检查点**: v2_fix_lark

---

## [2026-04-04 11:50:14] BUG-005 REPORTED

- **标题**: OPENAI_API_KEY为空(HOME改变导致keychain不可达)
- **严重度**: P0
- **组件**: env
- **描述**: 启动时HOME设为lark-cli隔离目录，security命令找不到login keychain
- **实际**: OPENAI_API_KEY is required，所有LLM调用失败

---

## [2026-04-04 11:50:15] BUG-005 -> fixed

- **标题**: OPENAI_API_KEY为空(HOME改变导致keychain不可达)
- **根因**: shell展开顺序：HOME=x时security已在新HOME下运行
- **修复**: 启动前用真实HOME获取key，再作为环境变量传入
- **检查点**: v2_fix_apikey

---

## [2026-04-04 11:50:15] BUG-006 REPORTED

- **标题**: lark-cli subscribe单实例冲突
- **严重度**: P1
- **组件**: lark
- **描述**: 其他launchd服务占用同一app的事件订阅
- **实际**: another event +subscribe instance is already running

---

## [2026-04-04 11:50:15] BUG-006 -> fixed

- **标题**: lark-cli subscribe单实例冲突
- **根因**: com.shiyangcui.lark-bot-worker launchd服务自动重启占用subscribe
- **修复**: 停掉所有旧launchd服务后再启动
- **检查点**: v2_fix_subscribe

---

## [2026-04-04 11:50:16] BUG-007 REPORTED

- **标题**: lark-cli subscribe参数--event-type(单数)错误
- **严重度**: P1
- **组件**: lark
- **描述**: 应为--event-types(复数)加逗号分隔
- **实际**: unknown flag: --event-type

---

## [2026-04-04 11:50:16] BUG-007 -> fixed

- **标题**: lark-cli subscribe参数--event-type(单数)错误
- **根因**: lark-cli参数是--event-types
- **修复**: 改为--event-types加逗号拼接
- **检查点**: v2_fix_eventtype

---

## [2026-04-04 11:50:17] BUG-008 REPORTED

- **标题**: lark-cli配置路径不匹配
- **严重度**: P1
- **组件**: lark
- **描述**: gaia-bot用默认HOME启动，但lark-cli config.json在GGBot隔离HOME下
- **实际**: subscribe进程运行但无法收到消息

---

## [2026-04-04 11:50:17] BUG-008 -> fixed

- **标题**: lark-cli配置路径不匹配
- **根因**: lark-cli配置在~/.local/share/GGBot/home/.lark-cli/
- **修复**: 启动时设置LARK_HOME指向该路径
- **检查点**: v2_fix_home

---

## [2026-04-04 11:58:49] BUG-009 REPORTED

- **标题**: 回复中\n显示为字面文本而非换行
- **严重度**: P2
- **组件**: lark
- **描述**: sendText用JSON.stringify包裹文本，导致换行符被转义为字面\n
- **实际**: 飞书消息中显示字面\n字符

---

## [2026-04-04 11:58:50] BUG-009 -> fixed

- **标题**: 回复中\n显示为字面文本而非换行
- **根因**: JSON.stringify将\n转义为\\n，lark-cli --text直接传原始文本即可
- **修复**: 去掉sendText和replyText中的JSON.stringify
- **检查点**: v3_fix_newline

---

## [2026-04-04 12:27:58] BUG-010 REPORTED

- **标题**: --severity
- **严重度**: P3
- **组件**: other

---

## [2026-04-04 12:28:33] BUG-010 -> fixed

- **标题**: --severity
- **根因**: execSync将参数join为字符串传给shell,换行符导致命令拆分
- **修复**: 改用execFileSync,参数数组直接传递给进程
- **检查点**: v10_execFileSync

---

## [2026-04-04 12:40:55] BUG-011 REPORTED

- **标题**: Bot回复存储user_id='bot'导致历史对话断裂
- **严重度**: P0
- **组件**: pipeline
- **描述**: S6存储bot回复时senderId='bot',getRecentConversation按user_id查询时查不到bot的回复,LLM上下文只有用户消息没有bot回复,导致每次重新回答所有历史问题

---

## [2026-04-04 12:41:01] BUG-011 -> fixed

- **标题**: Bot回复存储user_id='bot'导致历史对话断裂
- **根因**: S6用senderId=bot存储bot回复,conversation_log按user_id查询时漏掉bot回复
- **修复**: 改用ctx.rawSenderId存储bot回复+排除当前消息重复
- **检查点**: v11_history_fix

---

## [2026-04-04 13:06:17] BUG-012 REPORTED

- **标题**: assistant消息content type错误导致LLM 400
- **严重度**: P0
- **组件**: llm
- **描述**: 修复BUG-011后历史首次包含assistant消息,但llm-client对所有role统一用input_text,OpenAI Responses API要求assistant用output_text

---

## [2026-04-04 13:06:18] BUG-012 -> fixed

- **标题**: assistant消息content type错误导致LLM 400
- **根因**: 所有消息统一用type:input_text
- **修复**: assistant消息改用type:output_text
- **检查点**: v12_output_text

---

## [2026-04-05 07:00:00] BUG-013 REPORTED

- **标题**: @别人时Gaia抢着回答
- **严重度**: P1
- **组件**: pipeline
- **描述**: 用户在群聊中@其他人时，Gaia（bot）仍然回复该消息。S1未区分@bot和@其他人，所有包含@的消息都被当作需要回复处理。
- **复现**: 1.在群聊中@另一个用户 2.发送消息 3.Gaia回复了该消息
- **期望**: Gaia不应该回复明确@给别人的消息
- **实际**: Gaia照常回复

---

## [2026-04-05 07:00:01] BUG-013 -> fixed

- **标题**: @别人时Gaia抢着回答
- **根因**: S1 message-dispatcher没有检测mentionedOther状态，所有消息无差别进入后续pipeline
- **修复**: S1新增mentionedOther检测（基于rawMentions + botOpenId比对）；S3S4在mentionedOther时注入`mentioned_other_context`行为让LLM判断是否插嘴；prompt-builder增加mentioned_other_context指令；LLM可回复[SKIP]表示不说话
- **涉及文件**: s1-message-dispatcher.ts, s3s4-cognitive-generator.ts, prompt-builder.ts, types.ts, pipeline-runner.ts, lark-client.ts, index.ts
- **检查点**: v13_mention_other

---

## [2026-04-05 07:10:00] BUG-014 REPORTED

- **标题**: @别人时硬跳过过于粗暴
- **严重度**: P2
- **组件**: pipeline
- **描述**: BUG-013初版修复在S1直接hard-skip @别人的消息，但真实场景中bot有时应该插嘴（话题相关、被遗漏@、有话想说）
- **复现**: 1.在群聊中@别人讨论与bot相关的话题 2.bot完全沉默
- **期望**: bot能根据上下文自主判断是否参与
- **实际**: bot一律沉默

---

## [2026-04-05 07:10:01] BUG-014 -> fixed

- **标题**: @别人时硬跳过过于粗暴
- **根因**: 初版在S1设置shouldReply=false直接跳过，没有给LLM判断的机会
- **修复**: S1只标记mentionedOther=true但不跳过；S3S4检测到mentionedOther时注入`mentioned_other_context`人类行为，prompt指导LLM自行判断：话题相关→自然插嘴，无关→回复[SKIP]；S3S4处理[SKIP]回复设置shouldReply=false
- **涉及文件**: s1-message-dispatcher.ts, s3s4-cognitive-generator.ts, prompt-builder.ts
- **检查点**: v14_mention_llm_decision

---

