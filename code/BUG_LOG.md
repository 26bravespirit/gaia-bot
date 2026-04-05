# Persona-bot Bug Log

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
- **描述**: persona-bot用默认HOME启动，但lark-cli config.json在GGBot隔离HOME下
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

## [2026-04-05 13:24:56] BUG-015 REPORTED

- **标题**: Phase 4 YAML 配置文件未复制到 dist/ 导致全量降级
- **严重度**: P0
- **组件**: build / config
- **描述**: `prompt_mappings.yaml` 和 `constraints.yaml` 放在 `src/config/` 下，`tsc` 只编译 `.ts` 文件不复制 YAML。运行时 `parameter-interpreter.ts` 读 `dist/config/*.yaml` → ENOENT → S3S4 崩溃 → 进入降级模式 → 所有回复变成 "嗯..."
- **复现**: 1. `npm run build`（仅 tsc） 2. `node dist/index.js` 3. 发任何消息 → 得到 "嗯..." 降级回复
- **期望**: 正常 LLM 生成回复
- **实际**: ENOENT → degradation_template → "嗯..."

---

## [2026-04-05 13:28:00] BUG-015 -> fixed

- **标题**: Phase 4 YAML 配置文件未复制到 dist/
- **根因**: tsc 不复制非 .ts 文件，dist/config/ 缺少 prompt_mappings.yaml 和 constraints.yaml
- **修复**: package.json build 脚本改为 `tsc && cp src/config/*.yaml dist/config/`
- **涉及文件**: package.json
- **检查点**: 03332cf

---

## [2026-04-05 13:30:00] BUG-016 REPORTED

- **标题**: 多段落回复作为单条消息发送，不像真人
- **严重度**: P2
- **组件**: pipeline / S6
- **描述**: LLM 生成的多段落回复（含 `\n\n` 分隔）被 S6 作为一整条消息发送。真人聊天时会把 3 个段落分成 3 条消息分别发送，中间有打字间隔。
- **复现**: 1. 发送需要较长回复的问题 2. 收到一条包含多段落的长消息
- **期望**: 3 个段落 → 3 条消息，每条间隔 500-1500ms
- **实际**: 1 条消息包含所有段落

---

## [2026-04-05 13:31:00] BUG-016 -> fixed

- **标题**: 多段落回复作为单条消息发送
- **根因**: S6 直接调用一次 sendText 发送 finalResponse 全文
- **修复**: S6 新增 `splitIntoMessages()` 方法，按双换行拆分段落，每段作为独立消息发送；段间加打字延迟（500-1500ms，按字数计算）；极短段落（<15字）合并避免刷屏；memory 仍记录完整回复
- **涉及文件**: s6-outbound-scheduler.ts
- **检查点**: 36f51b1

---

## [2026-04-05 13:33:00] BUG-017 REPORTED

- **标题**: 回复偏长、末尾引导性提问、缺乏随机性
- **严重度**: P1
- **组件**: pipeline / prompt
- **描述**: 三个相关问题：1) 回复内容明显偏多，远超真人微信聊天长度；2) 末尾经常加"想试试吗""有兴趣吗"等引导性提问，虽然口气不像AI但行为模式像AI；3) 每次回复都是"回答+展开+提问"三段式，缺乏随机变化
- **复现**: 连续发几条闲聊消息，观察回复模式
- **期望**: 短回复为主（1-3句），不主动加引导提问，回复长度和结构有随机变化
- **实际**: 每条都是3段式长回复，末尾带提问

---

## [2026-04-05 13:35:00] BUG-017 -> fixed

- **标题**: 回复偏长、末尾引导性提问、缺乏随机性
- **根因**: 1) anti_ai_rules 缺少硬性长度约束；2) S5 R02 尾部提问匹配只有3个pattern，漏掉大量变体；3) prompt 没有打破"三段式"的指令
- **修复**: constraints.yaml 反AI规则从6条扩展到9条——硬性禁止末尾引导提问（列举10+变体）、目标20-60字、要求随机变化长度、禁止三段式、禁止主动建议；S5 R02 尾部提问 pattern 从3个扩展到10个
- **涉及文件**: src/config/constraints.yaml, src/pipeline/s5-perception-wrapper.ts
- **检查点**: 96e7f32

---

## [2026-04-05 13:44:00] BUG-018 REPORTED

- **标题**: 回复长度由硬规则截断，缺乏自然随机性
- **严重度**: P2
- **组件**: pipeline / prompt
- **描述**: BUG-017 修复后 R04 阈值收紧到 1.2x/1.0x（72/60 字），但硬截断导致回复长度机械化——所有回复都被削到差不多长，缺乏真人聊天时"有时一个字有时一段话"的随机感。长度应该由概率生成而非规则裁剪。
- **复现**: 连续发多条消息，观察回复长度几乎一致（~60字左右）
- **期望**: 长度随机变化——有时1个字，有时一句话，有时几句
- **实际**: R04 统一截到 avg_message_length 附近

---

## [2026-04-05 13:45:00] BUG-018 -> fixed

- **标题**: 回复长度由硬规则截断，缺乏自然随机性
- **根因**: R04 用硬阈值（1.2x 触发，截到 1.0x）控制长度，所有回复趋同
- **修复**: 长度控制移到 prompt 层，每次请求随机掷骰：15% 超短（1-4字）、35% 短（<30字）、30% 正常（30-60字）、20% 稍长（<80字）。R04 退回安全网角色（仅 >3x 时截断）。constraints.yaml 同步更新。
- **涉及文件**: src/llm/prompt-builder.ts, src/pipeline/s5-perception-wrapper.ts, src/config/constraints.yaml
- **检查点**: 3a9b82c

---

## [2026-04-05 13:50:00] BUG-019 REPORTED

- **标题**: 长度概率写死在代码中，无法运行时调整
- **严重度**: P2
- **组件**: prompt / config
- **描述**: BUG-018 将长度控制改为概率，但四档概率（15%/35%/30%/20%）和对应 prompt 模板硬编码在 prompt-builder.ts 中。调整分布需要改代码重新编译部署，不满足热配置需求。
- **期望**: 概率分布和模板存储在数据库中，运行时 SQL 修改立即生效
- **实际**: 硬编码在 TypeScript 源码中

---

## [2026-04-05 13:54:00] BUG-019 -> fixed

- **标题**: 长度概率写死在代码中，无法运行时调整
- **根因**: 概率和模板硬编码在 prompt-builder.ts
- **修复**: 新增 `runtime_config` 数据库表（key/value + updated_at），存储 `length_distribution` 和 `length_templates` 两个 JSON 配置；MemoryManager 暴露 `getLengthDistribution()` / `getLengthTemplates()` 方法（带硬编码 fallback）；S3S4 注入 memory 引用并通过 PromptContext 传递分布数据；运行时修改：`UPDATE runtime_config SET value='...' WHERE key='length_distribution'` 即时生效无需重启
- **涉及文件**: working-memory.ts, memory-manager.ts, prompt-builder.ts, s3s4-cognitive-generator.ts, index.ts
- **检查点**: 332a04a

---

## [2026-04-05 14:00:00] BUG-020 REPORTED

- **标题**: 长期记忆表始终为空，用户说的话没有落入长期记忆
- **严重度**: P0
- **组件**: pipeline / memory
- **描述**: `long_term_memories` 表有完整的读取逻辑（S2 searchMemories）但整个代码库没有任何地方调用 `addMemory()` 写入。传记事实有 S4.5 自动提取，但长期记忆（用户的个人信息、情感事件、承诺等）完全没有提取器。结果是记忆系统形同虚设——bot 永远不会"记住"用户说过的重要事情。
- **复现**: 聊天多轮后查询 `SELECT COUNT(*) FROM long_term_memories` → 0
- **期望**: 用户提到的个人信息、情感事件、承诺等被提取并存储
- **实际**: 表始终为空

---

## [2026-04-05 14:02:00] BUG-020 -> fixed

- **标题**: 长期记忆表始终为空
- **根因**: 没有长期记忆提取器——只有读取逻辑没有写入逻辑
- **修复**: 新增 S4.6 MemoryExtractor，通过 LLM 分析用户消息提取四类记忆（emotional_event / promise / shared_experience / factual_detail），fire-and-forget 异步写入。Pipeline 顺序：S4.5→S4.6→S5。另新增 `scripts/inspect-memory.js` 查询工具。
- **涉及文件**: src/pipeline/s4-6-memory-extractor.ts (新建), src/index.ts, scripts/inspect-memory.js (新建)
- **检查点**: 1bc57e3

---

## [2026-04-05 14:30:00] BUG-021 REPORTED

- **标题**: S4.5 将 AI 身份信息存为传记事实
- **严重度**: P1
- **组件**: pipeline / S4.5
- **描述**: S4.5 传记提取器将 bot 回复中的"只能在聊天框里与对方进行文字互动，无法访问对方本地文件"提取为传记事实（importance=0.8），这是 AI 身份泄漏信息，不应出现在人格传记中。
- **复现**: 查询 `SELECT * FROM biographical_facts WHERE fact_content LIKE '%聊天框%'`
- **期望**: 包含 AI/技术相关内容的事实应被过滤
- **实际**: 被存为高重要度传记事实

---

## [2026-04-05 14:32:00] BUG-021 -> fixed

- **标题**: S4.5 将 AI 身份信息存为传记事实
- **根因**: S4.5 只检查 forbidden_fabrications，没有 AI 身份关键词过滤
- **修复**: 在 forbidden check 后加 regex 过滤器，拦截包含 AI 相关关键词的事实（聊天框/无法访问/AI/语言模型/机器人/程序/代码/服务器/API/token/prompt）。已从 DB 删除泄漏记录。
- **涉及文件**: src/pipeline/s4-5-biographical-extractor.ts
- **检查点**: 770dcdb

---

## [2026-04-05 14:30:00] BUG-022 REPORTED

- **标题**: socialBattery 只衰减不回充，最终趋近于 0
- **严重度**: P2
- **组件**: pipeline / self_state
- **描述**: socialBattery 每次回复后衰减 0.02，但没有恢复机制。经过 ~50 次交互后降到 0.16，再聊下去会触发"社交电量耗尽"的 prompt 提示，bot 变得异常简短。真人的社交电量在休息（不聊天）后会自然恢复。
- **复现**: 查询 `SELECT social_battery FROM self_state` → 0.16
- **期望**: 沉默一段时间后 socialBattery 自动回充
- **实际**: 只降不升

---

## [2026-04-05 14:32:00] BUG-022 -> fixed

- **标题**: socialBattery 只衰减不回充
- **根因**: S2 和 index.ts 只做 socialBattery -= 0.02，没有回充逻辑
- **修复**: S2 在加载 selfState 后计算沉默时长（当前时间 - updatedAt），沉默 ≥1 小时时按 0.15/小时回充（上限 1.0），心情也按 0.03/小时恢复。回充后的值随 updates 一起写回 DB。
- **涉及文件**: src/pipeline/s2-context-assembler.ts
- **检查点**: 770dcdb

---

## [2026-04-05 14:50:00] BUG-023 REPORTED

- **标题**: S4.6 长期记忆提取率过低（60条消息仅提取2条）
- **严重度**: P1
- **组件**: pipeline / S4.6
- **描述**: S4.6 用 LLM 异步提取长期记忆，但 fire-and-forget 模式下大量 LLM 调用因并发占用或超时被静默吞掉。60 条对话只成功提取 2 条 LTM。用户多次提到蓝山咖啡、Coffee Academics、不喜欢不纯粹的咖啡店等重要偏好全部丢失。
- **期望**: 高频对话中也能可靠提取用户偏好
- **实际**: 仅约 3% 的提取率

---

## [2026-04-05 14:50:00] BUG-024 REPORTED

- **标题**: 关系模型 topics_shared 始终为空
- **严重度**: P2
- **组件**: pipeline / relationship
- **描述**: RelationshipModel 有 addTopic() 方法但没有代码调用它。S2 检测到对话主题后只写入 selfState.recentExperiences，不写入关系模型的 topics_shared。

---

## [2026-04-05 14:50:00] BUG-025 REPORTED

- **标题**: extractExperiences 缺少常见话题覆盖
- **严重度**: P3
- **组件**: pipeline / S2
- **描述**: 话题检测正则只覆盖 7 个主题，缺少咖啡、音乐、影视、工作、星座、运动、宠物等常见话题。

---

## [2026-04-05 14:56:00] BUG-023/024/025 -> fixed

- **根因**: (023) 纯依赖 LLM 异步提取，无同步兜底；(024) addTopic() 没人调用；(025) 正则覆盖不足
- **修复**: S4.6 新增 9 个正则 fallback 同步提取（带去重）；S2 调用 addTopic() 写入关系模型；话题扩展到 14 个
- **涉及文件**: s4-6-memory-extractor.ts, s2-context-assembler.ts
- **检查点**: 6669416

---

## [2026-04-05 15:00:00] BUG-023 补充分析 + 方案 B 重构

- **深层根因**:
  1. 并发竞争: S3S4/S4.5/S4.6 三个 LLM 调用共享同一 API key，S4.6 作为第 3 个最易被 429 限流
  2. 日志静默: 关键失败日志用 logger.debug，默认 info level 全部过滤不可见
  3. 模型共享: 用主力 gpt-5.1 做简单提取，不必要的资源竞争
  4. 无重试: fire-and-forget 一次失败永久丢失
  5. 无上下文: 逐条提取缺少对话上下文，无法推断隐式偏好
- **方案 B 重构**: S4.6 改为批量延迟提取。正则即时兜底 + 攒 5 条消息后 1 次 LLM 批量调用（含完整上下文）。2 分钟超时自动 flush。shutdown 时 flush 剩余 buffer。所有日志升级为 warn/info。
- **预期效果**: 5 条消息 1 次 API 调用（原来 5 次），不与 S3S4 并发竞争，有上下文能推断隐式偏好
- **检查点**: 55ea5bd

---

## [2026-04-05 15:05:00] BUG-026 REPORTED

- **标题**: S4.5 和 S4.6 各自独立批量提取，仍可能并发冲突
- **严重度**: P2
- **组件**: pipeline / extraction
- **描述**: BUG-023 方案 B 将 S4.6 改为批量提取，但 S4.5 仍是逐条 fire-and-forget。两者各自独立调用 LLM，flush 时机不可控仍可能撞车。需要统一调度。

---

## [2026-04-05 15:08:00] BUG-026 -> fixed

- **标题**: S4.5 和 S4.6 各自独立批量提取，仍可能并发冲突
- **根因**: 两个 extractor 各自管理 buffer 和 LLM 调用，无协调
- **修复**: 新建 `ExtractionScheduler` 共享调度器。S4.5 调 `pushBio()`，S4.6 调 `pushLtm()`，scheduler 统一管理 buffer 和 flush。flush 时先处理 bio batch（1次 LLM），等完成后再处理 LTM batch（1次 LLM），严格串行，永不并发。两者的正则即时提取保留不变。
- **涉及文件**: extraction-scheduler.ts (新建), s4-5-biographical-extractor.ts, s4-6-memory-extractor.ts, index.ts
- **检查点**: c96e0c4

---

## [2026-04-05 16:00:00] BUG-027 REPORTED

- **标题**: 多个 bot 实例同时运行，抢占消息通道
- **严重度**: P0
- **组件**: infra / 进程管理
- **描述**: 反复出现多个进程同时 subscribe 同一个飞书 app。根因：1) lark-bot-worker (launchd KeepAlive) 和 persona-bot 抢消息；2) 无单实例保护，每次启动叠加新进程；3) kill 不杀子进程树，subscribe 孤儿继续抢通道。

---

## [2026-04-05 16:04:00] BUG-027 -> fixed

- **根因**: 无单实例保护 + lark-bot-worker 竞争 + 子进程树未清理
- **修复**: 1) lark-bot-worker bootout + disable 永久停掉；2) PID 文件锁：启动自动杀旧实例整个进程树后接管；3) killProcessTree 递归找子进程 SIGTERM→SIGKILL；4) ecosystem.config.cjs treekill=true
- **涉及文件**: src/utils/pid-lock.ts (新建), src/index.ts, ecosystem.config.cjs, package.json
- **检查点**: 9fc1106

---

