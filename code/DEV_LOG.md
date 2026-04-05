# v0.2.0 Development Log

## Session: 2026-04-05

### Phase 1: Infrastructure (types + DB) ✅
- [x] Extended PipelineContext with S4.5/S5/S5.5 fields (biographyContext, cognitiveDecision, humanBehaviorsTriggered, s5StepsExecuted, antiAiFingerprint, antiAiScore, antiAiVerdict, isDegraded, degradationReason)
- [x] Added new types: AiFingerprint, AntiAiVerdict, CognitiveDecision, S5StepsExecuted, AntiAiRuleResult
- [x] Added new DB tables: biographical_facts, long_term_memories, self_state, event_log, relationships
- [x] Extended schemas.ts: BiographySchema, HumanBehaviorsSchema, AntiAiConfigSchema, MemoryBlurConfigSchema
- [x] Added biography anchors + human_behaviors + anti_ai + memory_blur to persona.yaml

### Phase 2: Memory System ✅
- [x] Created biographical-facts.ts (CRUD + conflict detection + user_visible filtering + anchor initialization)
- [x] Created long-term-memory.ts (keyword search + importance scoring + forgetting)
- [x] Created relationship-model.ts (stage management + intimacy calculation + promises)
- [x] Updated memory-manager.ts (integrated all new modules, shared DB instance)

### Phase 3: Pipeline Core ✅
- [x] Created s4-5-biographical-extractor.ts (async fire-and-forget, regex markers, forbidden fabrication check)
- [x] Upgraded s5-perception-wrapper.ts (4-step sub-pipeline: R01-R06 → Memory Blur → Imperfection → Trim/Prefix)
- [x] Created s5-5-anti-ai-validator.ts (8-dimension scoring, PASS/WARN/BLOCK thresholds)
- [x] Upgraded s2-context-assembler.ts (biography retrieval injection with keyword extraction)
- [x] Upgraded s3s4-cognitive-generator.ts (cognitive decision, human behaviors, degradation path)
- [x] Upgraded pipeline-runner.ts (S4.5 + S5.5 wiring, degradation skip logic, stage timing)

### Phase 4: Config & Parameters ✅
- [x] Updated prompt-builder.ts (Prompt Assembly Order: Block 1-4, biography constraints, human behaviors injection)
- [x] Updated index.ts (S4.5 + S5.5 stage registration)

### Phase 5: Code Review + Type Check ✅
- [x] TypeScript compilation: PASS (0 errors)
- [x] Fixed: `identity.name` → `meta.name` in watchPersona callback
- [x] Fixed: `memory_config?.immediate_window` → hardcoded 21 (non-existent field)
- [x] All 60 existing tests pass (59 stable + 1 flaky G3 due to LLM variance)

### Phase 6: UAT + SAT Testing
- [ ] Run full attack vector suite
- [ ] Run full UAT journey suite
- [ ] Validate new S5 4-step sub-pipeline behavior
- [ ] Validate S5.5 Anti-AI scoring

### New Files Created
- `src/memory/biographical-facts.ts`
- `src/memory/long-term-memory.ts`
- `src/memory/relationship-model.ts`
- `src/pipeline/s4-5-biographical-extractor.ts`
- `src/pipeline/s5-5-anti-ai-validator.ts`

### Modified Files
- `src/pipeline/types.ts` — Extended PipelineContext + new types
- `src/config/schemas.ts` — Biography, HumanBehaviors, AntiAi, MemoryBlur schemas
- `src/memory/working-memory.ts` — New tables + getDb() accessor
- `src/memory/memory-manager.ts` — Integrated all v0.2.0 modules
- `src/pipeline/s2-context-assembler.ts` — Biography retrieval + keyword extraction
- `src/pipeline/s3s4-cognitive-generator.ts` — Cognitive decision + human behaviors + degradation
- `src/pipeline/s5-perception-wrapper.ts` — 4-step sub-pipeline (R01-R06, blur, imperfection)
- `src/pipeline/pipeline-runner.ts` — Degradation path + S4.5/S5.5 skip logic
- `src/llm/prompt-builder.ts` — Prompt Assembly Order + biography + human behaviors
- `src/index.ts` — S4.5/S5.5 wiring + meta.name fix
- `persona.yaml` — Biography anchors + human_behaviors + anti_ai + memory_blur config

---

### v5.2: Multi-Service Architecture ✅

**设计文档**: `gaia-design/docs/MULTI_SERVICE_DESIGN.md`

基于 OpenClaw ChannelManager 模式，实现单进程管理多 lark-cli subscribe 子进程。

#### 新增文件
- `src/lark/conflict-resolver.ts` — launchd/进程冲突检测：锁文件读取 → PID 存活检测 → launchd bootout / SIGTERM
- `src/lark/lark-channel.ts` — 单 app 连接封装：subscribe 生命周期 + 指数退避重连（5s→5min, max 10次）+ AbortController 优雅取消
- `src/lark/channel-manager.ts` — 多 channel 生命周期管理 + `buildChannelManagerFromEnv()` 支持 legacy/advanced 两种配置模式
- `src/lark/message-router.ts` — 消息路由（当前透传，预留多 persona）
- `ecosystem.config.cjs` — pm2 配置

#### 修改文件
- `src/lark/lark-client.ts` — 移除 subscribe()，保留 sendText/sendCard/replyText
- `src/index.ts` — 用 ChannelManager 替换裸 subscribe 调用，优化 shutdown 逻辑
- `package.json` — 增加 pm2:start/stop/restart/logs/status scripts
- `.env` — 增加 SERVICE_NAME + LARK_CHANNELS（注释示例）
- `tests/pipeline/s1-dispatcher.test.ts` — 补充 rawMentions/mentionedOther 字段

#### 测试结果
- 全部 75 tests 通过（8 个文件）
- 新增 tests/lark/channel-manager.test.ts（ConflictResolver + LarkChannel + ChannelManager + MessageRouter + buildChannelManagerFromEnv）
