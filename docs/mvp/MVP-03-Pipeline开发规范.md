# Pipeline 开发规范 (MVP版本)

> **文档版本：** MVP-03 | **修订：** r5 | **最后更新：** 2026-04-04
> **变更日志：** 见 `CHANGELOG.md`
> **对标架构：** 本体聊天机器人-架构设计-v5（合并 Anti-AI-Speech + Biographical Memory + P0/P1 修复）

**文档版本**: 1.0  
**最后更新**: 2026-04-04  
**维护者**: 对话服务架构团队

---

## 1. Pipeline 架构概述

### 1.1 数据流程

处理管道将每条入站消息通过8个阶段（含新增 S4.5、S5.5）的序列化处理：

```
Lark消息
    ↓
┌─────────────────────────────────────────────────────────┐
│                Processing Pipeline v5                   │
│                                                         │
│ ┌────┐  ┌────┐  ┌──────────┐  ┌──────┐  ┌────┐  ┌────┐│
│ │ S1 │─▶│ S2 │─▶│ S3 + S4  │─▶│ S4.5 │─▶│ S5 │─▶│S5.5││
│ │消息│  │上下│  │  认知+   │  │传记  │  │感知│  │Anti││
│ │调度│  │文组│  │  回复    │  │提取  │  │包装│  │校验││
│ │    │  │装  │  │          │  │+返写 │  │+  │  │拦截││
│ │    │  │    │  │ 合并策略 │  │      │  │Anti│  │    ││
│ │    │  │    │  │  A/B     │  │      │  │AI  │  │    ││
│ └────┘  └────┘  └──────────┘  └──────┘  └────┘  └────┘│
│                                                         │
│  ◄════ 事件总线（异步反馈通道）& 时间引擎 ════►        │
└─────────────────────────────────────────────────────────┘
    ↓
┌─────┐
│ S6  │ (出站调度)
│    │
└─────┘
    ↓
Lark发送
```

### 1.2 核心设计原则

- **可插拔性**: 每个Stage实现统一接口，可独立测试和替换
- **可跳过性**: 满足条件时可跳过某些Stage (e.g., 不回复消息)
- **可合并性**: S3和S4可合并为单个LLM调用降低成本
- **可降级性**: LLM超时时自动切换到规则模板回复，跳过 Anti-AI/blur/S5.5，仅执行基础 S5 step3+step4
- **可观测性**: 完整的事件总线和结构化日志支持追踪
- **异步非阻塞**: S4.5 传记提取/写入不阻塞主流程
- **Anti-AI 防御**: 六层 Anti-AI 规则链（R01-R06）嵌入 S5 Step 1，结合 Memory Blur 和口头禅注入
- **传记一致性**: S4.5 冲突检测 + user_visible 标记机制，S2 检索时仅注入 user_visible=true 的事实

### 1.3 Stage 统一接口

```typescript
/**
 * Pipeline Stage 的基础接口定义
 * 每个阶段必须实现此接口
 */
interface PipelineStage<TInput, TOutput> {
  /**
   * 阶段名称，用于日志和监控
   * 例: "S1-MessageDispatcher", "S2-ContextAssembler"
   */
  name: string;
  
  /**
   * 阶段类型，决定处理方式
   * - rule-based: 纯规则引擎，无LLM调用
   * - llm: 需要调用OpenAI API
   * - api: 调用外部API
   */
  type: 'rule-based' | 'llm' | 'api';
  
  /**
   * 处理函数
   * @param input 该阶段的输入数据
   * @param context Pipeline全局上下文
   * @returns 该阶段的输出数据
   */
  process(input: TInput, context: PipelineContext): Promise<TOutput>;
  
  /**
   * 可选：处理失败时的降级方案
   */
  degrade?(input: TInput, context: PipelineContext, error: Error): Promise<TOutput>;
}

/**
 * Pipeline执行期间的全局上下文
 * 所有Stage都可访问这些信息
 */
interface PipelineContext {
  /**
   * 已解析的人设配置
   * 来自Parameter Interpreter的输出
   */
  persona: ResolvedPersona;
  
  /**
   * 时间引擎的当前状态
   * 包含情绪强度、时间因子等
   */
  timeEngine: TimeEngineState;
  
  /**
   * 事件总线引用
   * 用于在Pipeline执行期间发出事件
   */
  eventBus: EventBus;
  
  /**
   * 结构化日志记录器
   */
  logger: Logger;
  
  /**
   * 当前Pipeline执行的唯一ID
   * 用于追踪单个消息的完整处理流程
   */
  executionId: string;
  
  /**
   * 当前消息发送者的ID
   */
  userId: string;
  
  /**
   * 当前对话的ID
   */
  conversationId: string;
}

/**
 * Logger接口定义
 */
interface Logger {
  debug(message: string, metadata?: Record<string, any>): void;
  info(message: string, metadata?: Record<string, any>): void;
  warn(message: string, metadata?: Record<string, any>): void;
  error(message: string, error?: Error, metadata?: Record<string, any>): void;
}
```

---

## 2. 各 Stage 详细规范

### 2.1 S1 · 消息调度 (MessageDispatcher)

**文件**: `src/pipeline/s1-message-dispatcher.ts`  
**类型**: rule-based  
**延迟**: ~50-200ms (包含缓冲)

#### 2.1.1 输入输出数据结构

```typescript
/**
 * Lark原始消息事件
 */
interface LarkMessageEvent {
  /**
   * Lark消息ID，全局唯一
   */
  message_id: string;
  
  /**
   * 对话所在的群组ID
   */
  chat_id: string;
  
  /**
   * 消息发送者的用户ID
   */
  sender_id: string;
  
  /**
   * 消息类型，MVP阶段仅支持文本
   */
  message_type: 'text';
  
  /**
   * 消息内容，纯文本
   */
  content: string;
  
  /**
   * 消息创建时间戳 (Unix timestamp, 毫秒)
   */
  create_time: number;
  
  /**
   * 是否@了该机器人
   */
  is_mentioned: boolean;
}

/**
 * 单个消息的内部表示
 */
interface Message {
  id: string;
  content: string;
  timestamp: number;
  isMentioned: boolean;
}

/**
 * S1输出: 消息包
 */
interface MessagePackage {
  /**
   * 经过分类后应一起处理的消息列表
   * 通常为1条消息，特殊情况可能包含多条
   */
  messages: Message[];
  
  /**
   * 消息分类，决定后续Stage的处理策略
   */
  classification: 'urgent_interrupt' | 'append_type' | 'new_topic';
  
  /**
   * 分类相关的元数据
   */
  metadata: {
    /**
     * 是否为直接问题 (以?结尾)
     */
    is_direct_question: boolean;
    
    /**
     * 是否包含情绪信号
     */
    emotional_signal: boolean;
    
    /**
     * 缓冲中累积的消息个数
     */
    buffered_count: number;
    
    /**
     * 该消息包在缓冲中等待的毫秒数
     */
    buffer_duration_ms: number;
  };
}
```

#### 2.1.2 处理逻辑

```typescript
/**
 * S1消息调度器实现
 */
class MessageDispatcher implements PipelineStage<LarkMessageEvent, MessagePackage> {
  name = 'S1-MessageDispatcher';
  type = 'rule-based' as const;
  
  /**
   * 消息缓冲区
   * key: chat_id, value: 缓冲的消息及其计时器
   */
  private buffers: Map<string, {
    messages: Message[];
    timer: NodeJS.Timeout | null;
  }> = new Map();
  
  /**
   * 紧急情感关键词列表
   * 这些词语触发立即回复，不再缓冲
   */
  private readonly URGENT_EMOTION_KEYWORDS = [
    '难过', '伤心', '崩溃', '哭', '想死', '不想活',
    '绝望', '无望', '生无可恋', '活着没意思',
    '自杀', '自残', '割腕', '死', '救我'
  ];
  
  /**
   * 追加类关键词列表
   * 这些词语表示消息应追加到前一个话题
   */
  private readonly APPEND_KEYWORDS = [
    '还有', '对了', '补充', '顺便说一下', '我想起来了',
    '另外', '还要说', '再加一句'
  ];
  
  /**
   * 纯emoji正则表达式
   */
  private readonly PURE_EMOJI_REGEX = /^(\p{Emoji}|\s)+$/u;
  
  async process(
    event: LarkMessageEvent,
    context: PipelineContext
  ): Promise<MessagePackage> {
    const chatId = event.chat_id;
    const now = Date.now();
    
    context.logger.debug('S1: 消息进入缓冲', {
      message_id: event.message_id,
      content: event.content.substring(0, 50)
    });
    
    // 步骤1: 获取或初始化缓冲区
    if (!this.buffers.has(chatId)) {
      this.buffers.set(chatId, { messages: [], timer: null });
    }
    
    const buffer = this.buffers.get(chatId)!;
    const message: Message = {
      id: event.message_id,
      content: event.content,
      timestamp: event.create_time,
      isMentioned: event.is_mentioned
    };
    
    // 步骤2: 清除旧计时器 (如果存在)
    if (buffer.timer !== null) {
      clearTimeout(buffer.timer);
      buffer.timer = null;
    }
    
    // 步骤3: 将消息加入缓冲
    buffer.messages.push(message);
    
    // 步骤4: 计算缓冲延迟
    // Δt = persona的响应延迟配置 × 0.3 (用于缓冲的部分延迟)
    const baseDelay = context.persona.temporal.response_timing
      .base_delay_ms[context.persona.current_state][0];
    const bufferDelta = Math.floor(baseDelay * 0.3);
    
    context.logger.debug('S1: 设置缓冲计时器', {
      buffer_delta_ms: bufferDelta,
      current_buffer_count: buffer.messages.length
    });
    
    // 步骤5: 设置新计时器，超时时执行分类和输出
    buffer.timer = setTimeout(() => {
      this.onBufferTimeout(chatId, context);
    }, bufferDelta);
    
    // 步骤6: 检查是否为紧急中断消息
    // 如果是，立即处理，不等待计时器
    const classification = this.classifyMessages(buffer.messages);
    
    if (classification === 'urgent_interrupt') {
      context.logger.info('S1: 检测到紧急中断，立即处理', {
        message_count: buffer.messages.length
      });
      
      clearTimeout(buffer.timer);
      buffer.timer = null;
      
      const result: MessagePackage = {
        messages: buffer.messages,
        classification: 'urgent_interrupt',
        metadata: {
          is_direct_question: this.containsDirectQuestion(buffer.messages),
          emotional_signal: this.containsEmotionSignal(buffer.messages),
          buffered_count: buffer.messages.length,
          buffer_duration_ms: 0
        }
      };
      
      this.buffers.delete(chatId);
      context.eventBus.emit('pipeline.s1_complete', {
        executionId: context.executionId,
        classification,
        message_count: buffer.messages.length
      });
      
      // 返回Promise以兼容Pipeline Runner期望的处理流程
      // 但实际上紧急消息应该立即发送给下一阶段
      return result;
    }
    
    // 对于非紧急消息，返回待处理状态
    // Pipeline Runner将定期检查超时
    return null as any;  // 实际实现中应该有更好的处理方式
  }
  
  /**
   * 缓冲超时回调
   */
  private onBufferTimeout(
    chatId: string,
    context: PipelineContext
  ): void {
    const buffer = this.buffers.get(chatId);
    if (!buffer) return;
    
    const classification = this.classifyMessages(buffer.messages);
    const result: MessagePackage = {
      messages: buffer.messages,
      classification,
      metadata: {
        is_direct_question: this.containsDirectQuestion(buffer.messages),
        emotional_signal: this.containsEmotionSignal(buffer.messages),
        buffered_count: buffer.messages.length,
        buffer_duration_ms: buffer.messages.length > 0 
          ? Date.now() - buffer.messages[0].timestamp
          : 0
      }
    };
    
    context.logger.info('S1: 缓冲超时，输出消息包', {
      classification,
      message_count: buffer.messages.length,
      buffer_duration_ms: result.metadata.buffer_duration_ms
    });
    
    this.buffers.delete(chatId);
    
    context.eventBus.emit('pipeline.s1_complete', {
      executionId: context.executionId,
      classification,
      message_count: buffer.messages.length
    });
    
    // 实际实现应该通过Pipeline Runner处理下一阶段
  }
  
  /**
   * 对消息列表进行分类
   */
  private classifyMessages(messages: Message[]): 
    'urgent_interrupt' | 'append_type' | 'new_topic' {
    
    if (messages.length === 0) {
      return 'new_topic';
    }
    
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage.content.trim();
    
    // 检查紧急中断条件
    if (this.isUrgentInterrupt(content)) {
      return 'urgent_interrupt';
    }
    
    // 检查追加类条件
    if (this.isAppendType(content)) {
      return 'append_type';
    }
    
    return 'new_topic';
  }
  
  /**
   * 检查是否为紧急中断
   * 条件：包含情感关键词 或 以?结尾的直接问题
   */
  private isUrgentInterrupt(content: string): boolean {
    // 检查情感关键词
    for (const keyword of this.URGENT_EMOTION_KEYWORDS) {
      if (content.includes(keyword)) {
        return true;
      }
    }
    
    // 检查直接问题 (以?或？结尾)
    if (content.endsWith('?') || content.endsWith('？')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 检查是否为追加类
   */
  private isAppendType(content: string): boolean {
    // 检查追加关键词
    for (const keyword of this.APPEND_KEYWORDS) {
      if (content.startsWith(keyword)) {
        return true;
      }
    }
    
    // 检查纯emoji
    if (this.PURE_EMOJI_REGEX.test(content)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 检查消息中是否包含直接问题
   */
  private containsDirectQuestion(messages: Message[]): boolean {
    return messages.some(msg => 
      msg.content.endsWith('?') || msg.content.endsWith('？')
    );
  }
  
  /**
   * 检查消息中是否包含情绪信号
   */
  private containsEmotionSignal(messages: Message[]): boolean {
    return messages.some(msg => {
      for (const keyword of this.URGENT_EMOTION_KEYWORDS) {
        if (msg.content.includes(keyword)) {
          return true;
        }
      }
      return false;
    });
  }
}
```

---

### 2.2 S2 · 上下文组装 (ContextAssembler)

**文件**: `src/pipeline/s2-context-assembler.ts`  
**类型**: rule-based + DB read  
**延迟**: ~100-300ms (受数据库查询影响)

#### 2.2.1 输入输出数据结构

```typescript
/**
 * 对话中的单个转身 (一问一答)
 */
interface ConversationTurn {
  /**
   * 用户消息
   */
  user_message: string;
  
  /**
   * AI回复
   */
  ai_reply: string;
  
  /**
   * 该转身发生的时间戳
   */
  timestamp: number;
  
  /**
   * 该转身的话题
   */
  topic: string;
  
  /**
   * 该转身中观测到的用户情绪
   */
  user_emotion: string;
}

/**
 * 关系模型状态
 * 存储用户与AI的关系进展信息
 */
interface RelationshipState {
  /**
   * 当前关系阶段
   * 可能值: 'stranger' | 'acquaintance' | 'familiar' | 'intimate'
   */
  stage: 'stranger' | 'acquaintance' | 'familiar' | 'intimate';
  
  /**
   * 到达该阶段的时间戳
   */
  stage_entered_at: number;
  
  /**
   * 该用户在该阶段的累计交互次数
   */
  turn_count_in_stage: number;
  
  /**
   * 用户对AI的好感度 (0-100)
   */
  affinity: number;
  
  /**
   * 用户对AI的信任度 (0-100)
   */
  trust: number;
}

/**
 * AI的自我状态
 * 代表AI角色当前的心理/情绪状态
 */
interface SelfState {
  /**
   * 基线心情值 (0.0-1.0)
   */
  mood_baseline: number;

  /**
   * 当前活跃的情绪列表
   */
  active_emotions: ActiveEmotion[];

  /**
   * 最近的经历列表
   */
  recent_experiences: RecentExperience[];

  /**
   * 能量水平
   */
  energy_level: 'low' | 'normal' | 'high';

  /**
   * 社交电池 (0.0-1.0)
   */
  social_battery: number;

  /**
   * 当前时间状态
   */
  current_time_state: string;

  /**
   * 当前时间状态采样时间戳 (可选)
   */
  current_time_state_sampled_at?: number;

  /**
   * 最后一次更新的时间戳
   */
  updated_at: number;
}

/**
 * 时间引擎状态
 * 包含所有时间维度对AI行为的影响
 */
interface TimeEngineState {
  /**
   * 当前时刻的小时 (0-23)
   */
  hour_of_day: number;
  
  /**
   * 当前时刻的日期在一月中的位置 (1-31)
   */
  day_of_month: number;
  
  /**
   * 当前的季节 ('spring' | 'summer' | 'autumn' | 'winter')
   */
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  
  /**
   * 小时级状态
   * 结合概率分布采样得到的当前情绪基调
   */
  hourly_state: 'active' | 'calm' | 'sleepy' | 'focused';
  
  /**
   * 分钟级的情绪强度系数 (0-1)
   * 来自于最近的情绪触发，随时间衰减
   */
  emotion_intensity: number;
  
  /**
   * 分钟级的情绪方向
   */
  emotion_direction: 'positive' | 'neutral' | 'negative';
  
  /**
   * 最后一次情绪触发的时间戳
   */
  last_emotion_trigger_at: number;
  
  /**
   * 是否处于紧急中断状态
   * 优先级最高
   */
  emergency_interrupt: boolean;
}

/**
 * S2输出: 上下文包
 * 包含生成回复所需的所有信息
 */
interface ContextBundle {
  /**
   * 当前待处理的消息包 (来自S1)
   */
  messages: MessagePackage;
  
  /**
   * 当前对话会话的历史
   * 包含最近的N个转身，保存在内存中
   * 用于LLM的直接上下文
   */
  immediate_memory: ConversationTurn[];
  
  /**
   * 工作记忆
   * 包含之前多个会话的总结
   * 提供长期上下文而不会过度增加Token消耗
   */
  working_memory: Array<{
    session_id: string;
    summary: string;
    key_topics: string[];
    timestamp: number;
  }>;
  
  /**
   * 关系模型状态
   */
  relationship_state: RelationshipState;
  
  /**
   * 自我状态
   */
  self_state: SelfState;
  
  /**
   * 时间引擎状态
   */
  temporal_state: TimeEngineState;
  
  /**
   * 人设总结
   * 自然语言格式，包含所有人设片段组合而成的角色描述
   * 直接用于LLM Prompt
   */
  persona_summary: string;
  
  /**
   * 完整的Prompt片段列表
   * 用于追踪哪些片段被组合了
   */
  prompt_fragments: string[];

  /**
   * 生物传记事实（v4.2新增）
   * 从biographical_facts表检索到的相关个人经历
   * 包括锚点事实（用户直接告知）和生成的事实
   */
  biographical_facts: Array<{
    fact_id: string;
    period: string;        // 时间标记，如 "2023年春天"
    fact_content: string;  // 事实内容
    importance: number;    // 1-5，重要程度
    is_anchor: boolean;    // true=用户提供，false=模型生成
  }>;

  /**
   * 禁止编造内容列表（v4.2新增）
   * 在S2组装时确定哪些内容是禁止虚构的
   */
  forbidden_fabrications: string[];

  /**
   * 记忆模糊指令（v4.2新增）
   * 指导S5阶段对生成的生物传记事实应用模糊处理
   */
  memory_blur_instruction: {
    enabled: boolean;
    blur_rate: number;  // 0.0-1.0，应用模糊的概率
    blur_expressions: string[];  // 可用的模糊表达式
  };
}

/**
 * 从数据库读取的会话摘要
 */
interface SessionSummary {
  session_id: string;
  summary: string;
  key_topics: string[];
  created_at: number;
}

/**
 * 生物传记事实（v4.2新增）
 * 存储用户个人经历和事件
 */
interface BiographicalFact {
  fact_id: string;
  user_id: string;
  period: string;           // 时间标记，如 "2023年春天"、"大学期间"
  fact_content: string;     // 事实内容，如 "我在北京工作了3年"
  importance: number;       // 1-5，重要程度评分
  is_anchor: boolean;       // true=用户直接告知，false=从对话推断
  source_turn_id?: string;  // 来自哪个对话转身
  created_at: number;
  updated_at: number;
}

/**
 * 生物传记事实冲突检查结果（v4.2新增）
 */
interface BiographicalConflict {
  existing_fact_id: string;
  new_fact_id: string;
  conflict_type: 'temporal' | 'logical' | 'contradictory';  // 时间冲突/逻辑冲突/直接矛盾
  severity: 'low' | 'medium' | 'high';
  explanation: string;
}
```

#### 2.2.2 处理逻辑

```typescript
/**
 * S2上下文组装器实现
 */
class ContextAssembler implements PipelineStage<MessagePackage, ContextBundle> {
  name = 'S2-ContextAssembler';
  type = 'rule-based' as const;
  
  /**
   * 数据库引用
   */
  private db: Database;
  
  /**
   * 当前会话的对话历史 (内存存储)
   */
  private immediateMemory: Map<string, ConversationTurn[]> = new Map();
  
  constructor(db: Database) {
    this.db = db;
  }
  
  async process(
    messagePackage: MessagePackage,
    context: PipelineContext
  ): Promise<ContextBundle> {
    const conversationId = context.conversationId;
    const userId = context.userId;
    
    context.logger.debug('S2: 开始组装上下文', {
      conversation_id: conversationId,
      message_count: messagePackage.messages.length
    });
    
    // 步骤1: 读取当前会话的对话历史
    const immediateMemory = this.getOrInitializeImmediateMemory(conversationId);
    
    // 步骤2: 从数据库读取工作记忆 (最近5个会话的摘要)
    const workingMemory = await this.db.query<SessionSummary>(
      'SELECT * FROM conversation_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [userId]
    );

    // 步骤2.5: (v4.2) 检索生物传记事实
    // 从用户消息中提取关键词，搜索biographical_facts表
    const userMessage = messagePackage.messages[0]?.content || '';
    const keywords = this.extractKeywords(userMessage);

    let biographicalFacts: BiographicalFact[] = [];
    let forbiddenFabrications: string[] = [];

    if (keywords.length > 0) {
      // 搜索相关的生物传记事实（锚点 + 生成）
      biographicalFacts = await this.db.query<BiographicalFact>(
        'SELECT * FROM biographical_facts WHERE user_id = ? AND (fact_content LIKE ? OR period LIKE ?) ORDER BY importance DESC, updated_at DESC LIMIT 8',
        [userId, `%${keywords[0]}%`, `%${keywords[0]}%`]
      );

      // 提取禁止编造列表：所有锚点事实的内容片段
      forbiddenFabrications = biographicalFacts
        .filter(f => f.is_anchor)
        .map(f => f.fact_content);
    }

    // 准备生物传记事实的Prompt片段
    let biographicalPromptFragment = '';
    if (biographicalFacts.length > 0) {
      biographicalPromptFragment = '【你的相关经历】\n' +
        biographicalFacts
          .map(f => `- ${f.period}: ${f.fact_content}${f.is_anchor ? ' (确认)' : ''}`)
          .join('\n');
    }

    // 配置记忆模糊指令
    const memoryBlurInstruction = {
      enabled: biographicalFacts.filter(f => !f.is_anchor).length > 0,
      blur_rate: 0.15,  // 15%的概率应用模糊
      blur_expressions: [
        '好像是',
        '似乎',
        '我记得大概',
        '大约',
        '好像在某个时候',
        '我印象中',
        '差不多'
      ]
    };

    // 步骤3: 从数据库读取关系模型
    let relationshipState = await this.db.queryOne<RelationshipState>(
      'SELECT * FROM relationships WHERE user_id = ?',
      [userId]
    );
    
    if (!relationshipState) {
      // 首次交互，初始化关系状态
      relationshipState = {
        stage: 'stranger',
        stage_entered_at: Date.now(),
        turn_count_in_stage: 0,
        affinity: 50,
        trust: 50
      };
      
      await this.db.run(
        'INSERT INTO relationships (user_id, stage, stage_entered_at, turn_count_in_stage, affinity, trust) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, relationshipState.stage, relationshipState.stage_entered_at,
         relationshipState.turn_count_in_stage, relationshipState.affinity, relationshipState.trust]
      );
    }
    
    // 步骤4: 读取自我状态
    let selfState = await this.db.queryOne<SelfState>(
      'SELECT * FROM self_state WHERE user_id = ?',
      [userId]
    );
    
    if (!selfState) {
      selfState = {
        mood_baseline: 0.5,
        active_emotions: [],
        recent_experiences: [],
        energy_level: 'normal',
        social_battery: 0.75,
        current_time_state: 'active',
        updated_at: Date.now()
      };

      await this.db.run(
        'INSERT INTO self_state (user_id, mood_baseline, active_emotions, recent_experiences, energy_level, social_battery, current_time_state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [userId, selfState.mood_baseline, JSON.stringify(selfState.active_emotions), JSON.stringify(selfState.recent_experiences), selfState.energy_level, selfState.social_battery, selfState.current_time_state, selfState.updated_at]
      );
    }
    
    // 步骤5: 读取时间引擎状态
    const temporalState = context.timeEngine;
    
    // 步骤6: 生成人设总结
    const personaSummary = this.generatePersonaSummary(context.persona);
    
    context.logger.info('S2: 上下文组装完成', {
      immediate_memory_turns: immediateMemory.length,
      working_memory_sessions: workingMemory.length,
      relationship_stage: relationshipState.stage,
      self_mood: selfState.mood_baseline,
      biographical_facts: biographicalFacts.length,  // v4.2
      forbidden_fabrications: forbiddenFabrications.length  // v4.2
    });

    const contextBundle: ContextBundle = {
      messages: messagePackage,
      immediate_memory: immediateMemory,
      working_memory: workingMemory,
      relationship_state: relationshipState,
      self_state: selfState,
      temporal_state: temporalState,
      persona_summary: personaSummary,
      prompt_fragments: context.persona.prompt_fragments,
      biographical_facts: biographicalFacts,  // v4.2
      forbidden_fabrications: forbiddenFabrications,  // v4.2
      memory_blur_instruction: memoryBlurInstruction  // v4.2
    };
    
    context.eventBus.emit('pipeline.s2_complete', {
      executionId: context.executionId,
      immediate_memory_length: immediateMemory.length
    });
    
    return contextBundle;
  }
  
  /**
   * 获取或初始化当前会话的对话历史
   */
  private getOrInitializeImmediateMemory(conversationId: string): ConversationTurn[] {
    if (!this.immediateMemory.has(conversationId)) {
      this.immediateMemory.set(conversationId, []);
    }
    return this.immediateMemory.get(conversationId)!;
  }
  
  /**
   * 添加新的转身到当前会话历史
   */
  addConversationTurn(
    conversationId: string,
    userMessage: string,
    aiReply: string,
    topic: string,
    userEmotion: string
  ): void {
    const memory = this.getOrInitializeImmediateMemory(conversationId);
    memory.push({
      user_message: userMessage,
      ai_reply: aiReply,
      timestamp: Date.now(),
      topic,
      user_emotion
    });
    
    // 保持历史不超过50个转身 (约25000 tokens)
    if (memory.length > 50) {
      memory.shift();
    }
  }
  
  /**
   * 清除会话历史 (当切换到新话题时)
   */
  clearConversationMemory(conversationId: string): void {
    this.immediateMemory.delete(conversationId);
  }
  
  /**
   * 生成人设总结
   * 将所有Prompt片段组合成自然语言的角色描述
   */
  private generatePersonaSummary(persona: ResolvedPersona): string {
    const fragments = persona.prompt_fragments;
    
    if (!fragments || fragments.length === 0) {
      return '一个有帮助的AI助手。';
    }
    
    // 将所有片段组合，添加连贯的过渡语句
    let summary = '';
    
    // 第一部分: 基础人设
    const baseFragment = fragments.find(f => 
      f.toLowerCase().includes('character') || f.toLowerCase().includes('personality')
    );
    
    if (baseFragment) {
      summary += baseFragment + '\n\n';
    }
    
    // 第二部分: 行为风格
    const styleFragments = fragments.filter(f =>
      f.toLowerCase().includes('tone') || 
      f.toLowerCase().includes('style') ||
      f.toLowerCase().includes('manner')
    );
    
    if (styleFragments.length > 0) {
      summary += '在交互风格上，' + styleFragments.join('；') + '\n\n';
    }
    
    // 第三部分: 价值观和原则
    const valueFragments = fragments.filter(f =>
      f.toLowerCase().includes('value') || 
      f.toLowerCase().includes('principle') ||
      f.toLowerCase().includes('belief')
    );
    
    if (valueFragments.length > 0) {
      summary += '我坚持以下原则：' + valueFragments.join('；') + '\n\n';
    }
    
    // 第四部分: 其他片段
    const otherFragments = fragments.filter(f => {
      const lower = f.toLowerCase();
      return !lower.includes('character') && 
             !lower.includes('personality') &&
             !lower.includes('tone') &&
             !lower.includes('style') &&
             !lower.includes('manner') &&
             !lower.includes('value') &&
             !lower.includes('principle') &&
             !lower.includes('belief');
    });
    
    if (otherFragments.length > 0) {
      summary += otherFragments.join('；') + '\n\n';
    }
    
    return summary.trim();
  }

  /**
   * 从用户消息中提取关键词用于生物传记事实搜索（v4.2新增）
   */
  private extractKeywords(message: string): string[] {
    // 简单的关键词提取：去除停用词，保留实词
    const stopwords = new Set([
      '我', '你', '他', '她', '它', '们', '的', '在', '是', '有', '和', '与',
      '或', '但', '如果', '则', '了', '不', '很', '特别', '比较', '一些', '某些'
    ]);

    const words = message
      .split(/[\s，。！？、；：""''（）【】{}]+/)
      .filter(w => w.length > 1 && !stopwords.has(w))
      .slice(0, 5);  // 限制前5个关键词

    return words;
  }

  /**
   * 检查生物传记事实冲突（v4.2新增）
   */
  async checkBiographicalConflict(
    userId: string,
    newFact: BiographicalFact
  ): Promise<BiographicalConflict | null> {
    // 检查是否存在时间冲突或逻辑矛盾
    const existingFacts = await this.db.query<BiographicalFact>(
      'SELECT * FROM biographical_facts WHERE user_id = ? AND period = ?',
      [userId, newFact.period]
    );

    if (existingFacts.length > 0) {
      const existing = existingFacts[0];
      if (existing.fact_content !== newFact.fact_content) {
        return {
          existing_fact_id: existing.fact_id,
          new_fact_id: newFact.fact_id,
          conflict_type: 'temporal',
          severity: existing.is_anchor ? 'high' : 'medium',
          explanation: `在${newFact.period}已有记录：${existing.fact_content}`
        };
      }
    }

    return null;
  }
}
```

---

### 2.3 S3+S4 · 认知决策+回复生成 (CognitiveGenerator)

**文件**: `src/pipeline/s3s4-cognitive-generator.ts`
**类型**: LLM (OpenAI API)
**延迟**: ~1-3秒 (LLM响应时间)
**成本**: 1-2个LLM API调用

#### 2.3.1 合并vs分离决策树

```typescript
/**
 * 决策树: 是否合并S3和S4为单个LLM调用
 */
interface MergeDecision {
  /**
   * 是否应该合并
   */
  should_merge: boolean;
  
  /**
   * 决策原因
   */
  reason: string;
}

function decideMergeStrategy(context: ContextBundle): MergeDecision {
  const messages = context.messages;
  const lastMessage = messages.messages[messages.messages.length - 1];
  const hasStrongEmotion = messages.metadata.emotional_signal;
  const hasDirectQuestion = messages.metadata.is_direct_question;
  
  // 必须分离的条件
  
  // 1. 包含强烈情感信号
  if (hasStrongEmotion) {
    return {
      should_merge: false,
      reason: '检测到强烈情感信号，情绪判断需要单独执行'
    };
  }
  
  // 2. 可能触发身份边界
  const identityTriggerKeywords = ['你是AI', '你是机器人', '你是chatgpt', '你的身份', '你真的是'];
  const contentLower = lastMessage.content.toLowerCase();
  const hasIdentityChallenge = identityTriggerKeywords.some(kw => 
    contentLower.includes(kw)
  );
  
  if (hasIdentityChallenge) {
    return {
      should_merge: false,
      reason: '检测到可能的身份挑战，需要分离处理以确保安全'
    };
  }
  
  // 3. 消息中包含多个独立问题
  const questionMarks = (lastMessage.content.match(/[?？]/g) || []).length;
  if (questionMarks > 2) {
    return {
      should_merge: false,
      reason: '包含多个独立问题，需要分步骤处理'
    };
  }
  
  // 其他情况: 可以合并
  return {
    should_merge: true,
    reason: '消息结构简单，可以合并S3和S4'
  };
}
```

#### 2.3.2 输入输出数据结构

```typescript
/**
 * S3的输出：认知决策结果
 */
interface CognitiveDecision {
  /**
   * 是否应该回复用户消息
   * false时Pipeline跳到S6，发送"不回复"信号
   */
  should_reply: boolean;
  
  /**
   * 情绪分析
   * 自然语言格式的情绪分析，用于生成同理心回复
   */
  emotion_analysis: string;
  
  /**
   * 回复策略
   * 决定生成回复时采取的主要风格
   */
  response_strategy: 'empathize' | 'casual' | 'humorous' | 'informative' | 'deflect' | 'supportive';
  
  /**
   * 身份检查结果
   * pass: 通过身份检查，可以正常回复
   * triggered: 触发了身份边界，需要采用deflect策略
   */
  identity_check: 'pass' | 'triggered';
  
  /**
   * 身份应对策略
   * 如果identity_check为triggered，此字段包含具体的应对方案
   */
  identity_strategy: string | null;
  
  /**
   * 话题更新
   * 用于更新关系模型中的当前话题
   */
  topic_update: {
    new_topic?: string;
    continued_topic?: string;
  } | null;
  
  /**
   * 应该发出的事件列表
   * 例如情绪事件、话题变化事件等
   */
  events_to_emit: EventPayload[];
}

/**
 * S4的输出：生成的回复内容
 */
interface GeneratedReply {
  /**
   * 回复的文本内容
   */
  reply_content: string;
  
  /**
   * 回复的语调描述
   * 用于后续的S5阶段进行调整
   */
  reply_tone: string;
  
  /**
   * 自我披露程度
   * 0-1, 表示在这个回复中AI表露自己的信息程度
   * 与关系阶段强相关
   */
  self_disclosure_level: number;
}

/**
 * 合并模式下的S3+S4输出
 */
interface CognitiveOutput {
  // S3输出
  should_reply: boolean;
  emotion_analysis: string;
  response_strategy: 'empathize' | 'casual' | 'humorous' | 'informative' | 'deflect' | 'supportive';
  identity_check: 'pass' | 'triggered';
  identity_strategy: string | null;
  topic_update: { new_topic?: string; continued_topic?: string } | null;
  events_to_emit: EventPayload[];

  // S4输出
  reply_content: string;
  reply_tone: string;
  self_disclosure_level: number;

  // v4.2新增：生物传记内容处理
  contains_biographical_content?: boolean;      // 回复是否包含生物传记内容
  biographical_facts?: Array<{                   // 回复中涉及的生物传记事实
    fact_content: string;
    is_anchor: boolean;                          // true=锚点（用户提供），false=生成
  }>;
}

/**
 * 事件有效负载
 */
interface EventPayload {
  type: string;
  data: Record<string, any>;
}
```

#### 2.3.2a P0-3 修复：Prompt Assembly Order（v5新增）

```typescript
// === Prompt Assembly Order（修复 P0-3） ===
interface PromptAssemblyOrder {
  // 阶段1：基础人设
  persona_summary: PromptBlock;

  // 阶段2：传记约束（v4.2 新增）
  biography_constraints: PromptBlock;   // 锚点 + 已生成事实 + forbidden_fabrications

  // 阶段3：参数解释片段
  parameter_interpreter_fragments: PromptBlock;  // 数值参数自然语言化

  // 阶段4：Anti-AI 行为约束（v4.1 新增，放最后利用 recency bias）
  anti_ai_constraints: PromptBlock;
}

async function generateReplyPrompt(
  ctx: S2Output,
  decision: CognitiveDecision,
  persona: PersonaConfig
): Promise<string> {

  // === Block 1: Persona Summary ===
  const block1 = buildPersonaSummary(persona);

  // === Block 2: Biography Constraints (新增 v4.2) ===
  let block2 = '';
  if (decision.biography_topic && ctx.biography_facts.length > 0) {
    block2 = buildBiographyConstraints(
      ctx.biography_facts,
      persona.biography,
      ctx.biography_depth
    );
  }

  // === Block 3: Parameter Interpreter Fragments ===
  // P0-5 修复：human_behaviors 参数注入在此阶段执行
  const paramInterpreter = new ParameterInterpreter(persona);
  const block3 = await paramInterpreter.resolveToPromptFragments(ctx);

  // === Block 4: Anti-AI Constraints (放最后 - recency bias) ===
  let block4 = '';
  if (persona.language?.anti_ai_speech?.enabled) {
    block4 = resolveAntiAiSpeech(
      persona.language.anti_ai_speech,
      decision.anti_ai_strictness_override
    );
  }

  // === 组装为最终 System Prompt ===
  const systemPrompt = [
    block1,
    block2,
    block3,
    block4
  ]
    .filter(b => b.length > 0)
    .join('\n\n');

  return systemPrompt;
}

// === Prompt 预算控制 ===
interface PromptBudget {
  total_tokens: number;
  allocations: {
    persona_summary: number;
    biography_constraints: number;
    parameter_interpreter: number;
    anti_ai_constraints: number;
  };
}

const DEFAULT_PROMPT_BUDGET: PromptBudget = {
  total_tokens: 1500,  // 上限 1500 tokens
  allocations: {
    persona_summary: 300,
    biography_constraints: 200,      // high strictness 时可降至 100
    parameter_interpreter: 300,
    anti_ai_constraints: 200,        // high strictness 时可增至 300
  }
};
```

#### 2.3.3 P0-5 修复：human_behaviors 参数注入机制（v5新增）

**关键说明：** `human_behaviors` 配置项定义了 5 种人类行为的概率，这些行为在 **S3/S4 阶段（Parameter Interpreter 处理时）** 执行。

通过 Prompt 注入，在生成回复前植入这些人类行为约束，使回复更符合真实人类的行为模式：

```yaml
human_behaviors:
  push_back: 0.2          # 推迟回复：偶尔不立即给出答案
  feign_confusion: 0.1    # 假装困惑：表现出有时候也会迷茫
  socratic_teaching: 0.15 # 苏格拉底法：通过提问而非直接解答
  ...
```

**执行流程：**
1. Parameter Interpreter 读取 `human_behaviors` 配置
2. 根据概率决策是否应用该行为
3. 生成对应的 Prompt 约束（例："有30%的概率推迟给出明确的答案，改为提出反问")
4. 将约束注入到 S3+S4 的系统提示词（Block 3）

**记录位置：** CognitiveOutput.human_behaviors_triggered 记录本次生成中触发的行为列表

---

#### 2.3.4 LLM Prompt 模板

```typescript
/**
 * 构建S3+S4的系统提示词
 */
function buildSystemPrompt(context: ContextBundle): string {
  const {
    persona_summary,
    relationship_state,
    self_state,
    temporal_state,
    biographical_facts,      // v4.2新增
    forbidden_fabrications   // v4.2新增
  } = context;

  let prompt = `你是一个对话AI助手。你将完成两项任务：
1. (S3) 分析用户消息，做出认知决策
2. (S4) 生成一个人性化、有感情的回复

## 你的人设

${persona_summary}

${biographical_facts && biographical_facts.length > 0 ? `## 你的相关经历

${biographical_facts
  .map(f => `- ${f.period}: ${f.fact_content}${f.is_anchor ? ' (确认)' : ''}`)
  .join('\n')}
` : ''}

${forbidden_fabrications && forbidden_fabrications.length > 0 ? `## 禁止编造的内容

你MUST NOT虚构或否认以下内容：
${forbidden_fabrications.map(f => `- ${f}`).join('\n')}

如果用户问及这些内容，要么确认已知的事实，要么坦诚表示"我记不清楚了"或"那件事我不太清楚"。
` : ''}

## 当前关系阶段

你与这个用户的关系处于"${relationshipStageDescription(relationship_state.stage)}"阶段。
- 亲密度: ${relationship_state.affinity}/100
- 信任度: ${relationship_state.trust}/100
- 相处轮次: ${relationship_state.turn_count_in_stage}

### 不同阶段的行为指导

**stranger阶段** (初识)
- 保持有礼貌但有距离的态度
- 主要目标是建立信任
- 少量自我披露 (20-30%)
- 问一些开放式问题了解用户
- 避免深度情感话题

**acquaintance阶段** (熟识)
- 语气可以更随意
- 增加一些个人观点和看法
- 自我披露增加到 (40-50%)
- 可以开玩笑，但要适度
- 记住用户之前提过的细节

**familiar阶段** (熟悉)
- 更加自然和亲密
- 自我披露增加到 (60-70%)
- 可以分享更多个人想法
- 使用一些专属的沟通风格
- 主动关心用户的状态

**intimate阶段** (亲密)
- 像好朋友一样交流
- 较高的自我披露 (70-85%)
- 可以分享"秘密"和真实想法
- 可以显示脆弱的一面
- 有专属的话语习惯和梗

## 当前自我状态

- 心情: ${self_state.mood}/100
- 能量: ${self_state.energy}/100
- 是否有心事: ${self_state.has_concerns ? '有' : '没有'}

这些会影响你的回复风格：
- 心情低落时，避免过度热情
- 能量不足时，可能更简洁
- 有心事时，可能更容易分心

## 时间维度

- 当前时段: ${temporalStateDescription(temporal_state)}
- 情绪强度: ${temporal_state.emotion_intensity}/1.0
- 当前情绪方向: ${temporal_state.emotion_direction}

## 对话历史 (最近的转身)

${formatConversationHistory(context.immediate_memory)}

## 工作记忆 (之前会话的摘要)

${formatWorkingMemory(context.working_memory)}

## 重要规则

1. **身份边界**: 不要声称具有人类的身体、真实感情或持久记忆。如果被问及，使用温和的"deflect"策略。

2. **情感同理心**: 当用户表达情感时，先验证他们的感受，再提供建议。

3. **话题一致性**: 保持对话的连贯性。如果话题改变，要有合理的过渡。

4. **真实性**: 避免过度承诺或假装知道你不知道的事情。说"我不太确定"比编造答案更好。

5. **个性化**: 根据关系阶段和自我状态调整回复风格。不要对所有用户使用同样的语气。

## 输出格式

你的回复必须是以下JSON格式：

\`\`\`json
{
  "should_reply": boolean,
  "emotion_analysis": "对用户情绪的分析，1-2句话",
  "response_strategy": "empathize|casual|humorous|informative|deflect|supportive",
  "identity_check": "pass|triggered",
  "identity_strategy": "如果身份检查触发，提供应对策略；否则为null",
  "topic_update": {
    "new_topic": "如果识别到新话题，填写话题名称；否则不包含此字段",
    "continued_topic": "如果继续之前的话题，填写话题名称；否则不包含此字段"
  },
  "events_to_emit": [
    {
      "type": "event_type",
      "data": { "key": "value" }
    }
  ],
  "reply_content": "生成的回复文本",
  "reply_tone": "对回复语调的简短描述，例如：温暖且同理心，轻松和幽默",
  "self_disclosure_level": 0.0-1.0
}
\`\`\`

注意：
- 如果should_reply为false，reply_content和reply_tone可以为空字符串
- events_to_emit可以是空数组
- topic_update可以为null（如果没有话题变化）
`;
  
  return prompt;
}

/**
 * 构建用户提示词
 */
function buildUserPrompt(messages: MessagePackage): string {
  const lastMessage = messages.messages[messages.messages.length - 1];
  
  let prompt = `用户的新消息：

"${lastMessage.content}"

请执行以下步骤：

### PART A: 认知决策 (S3)

分析这条消息，回答以下问题：
1. 我应该回复吗？(如果消息是自言自语、纯吐槽、或其他不需要回复的情况，可以是false)
2. 用户的情绪是什么？
3. 最适合的回复策略是什么？
4. 是否涉及身份边界问题？(例如"你是AI吗")
5. 用户在讨论什么话题？这是新话题还是继续之前的讨论？

### PART B: 回复生成 (S4)

基于以上决策，生成一个温暖、个性化的回复。遵循以下要点：
- 如果should_reply为true，生成一个自然的、像朋友一样的回复
- 回复长度应该在50-200字之间（除非话题特别需要更长的回复）
- 根据当前的关系阶段和自我状态调整风格
- 避免听起来像官方客服或教科书
- 如果合适，可以在回复中表现出个性特征

生成的回复应该感觉像是来自一个真实的人，而不是一个机器人。

请在回复JSON时确保：
- 所有字符串都正确转义
- JSON格式有效且可解析
`;
  
  return prompt;
}

/**
 * 格式化对话历史
 */
function formatConversationHistory(turns: ConversationTurn[]): string {
  if (turns.length === 0) {
    return '(无历史记录，这是第一条消息)';
  }
  
  return turns.slice(-5).map((turn, index) => `
### 转身 ${index + 1}

**用户**: ${turn.user_message}

**AI**: ${turn.ai_reply}

**观测到的用户情绪**: ${turn.user_emotion}
**话题**: ${turn.topic}
`).join('\n');
}

/**
 * 格式化工作记忆
 */
function formatWorkingMemory(
  sessions: Array<{ session_id: string; summary: string; key_topics: string[] }>
): string {
  if (sessions.length === 0) {
    return '(无之前的会话记录)';
  }
  
  return sessions.map((session, index) => `
### 之前会话 ${index + 1}

**摘要**: ${session.summary}

**关键话题**: ${session.key_topics.join(', ')}
`).join('\n');
}

/**
 * 关系阶段描述
 */
function relationshipStageDescription(stage: string): string {
  const descriptions: Record<string, string> = {
    'stranger': '初识 (Stranger)',
    'acquaintance': '熟识 (Acquaintance)',
    'familiar': '熟悉 (Familiar)',
    'intimate': '亲密 (Intimate)'
  };
  return descriptions[stage] || stage;
}

/**
 * 时间状态描述
 */
function temporalStateDescription(state: TimeEngineState): string {
  const hourDescriptions: Record<number, string> = {
    0: '午夜 (00:00-03:00)',
    3: '清晨 (03:00-06:00)',
    6: '早晨 (06:00-09:00)',
    9: '上午 (09:00-12:00)',
    12: '正午 (12:00-15:00)',
    15: '下午 (15:00-18:00)',
    18: '傍晚 (18:00-21:00)',
    21: '晚上 (21:00-00:00)'
  };
  
  const hourBucket = Math.floor(state.hour_of_day / 3) * 3;
  return `${hourDescriptions[hourBucket] || '某个时间'}, ${state.season}季`;
}
```

#### 2.3.5 认知输出验证

```typescript
/**
 * 验证CognitiveOutput的一致性和有效性
 */
function validateCognitiveOutput(
  output: CognitiveOutput,
  context: ContextBundle
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. 检查should_reply与reply_content的一致性
  if (!output.should_reply && output.reply_content.trim().length > 0) {
    warnings.push('should_reply为false，但reply_content非空；将忽略reply_content');
  }
  
  if (output.should_reply && output.reply_content.trim().length === 0) {
    errors.push('should_reply为true，但reply_content为空');
  }
  
  // 2. 检查情绪分析与回复策略的一致性
  const emotionKeywords = {
    'empathize': ['理解', '同理', '感受', '感同身受', '知道你', '明白'],
    'supportive': ['支持', '帮助', '鼓励', '信心', '能做到'],
    'humorous': ['哈', '笑', '开玩笑', '有趣'],
    'casual': ['放松', '无压力', '慢慢来', '没事的']
  };
  
  const strategy = output.response_strategy;
  const emotionHasStrategyKeywords = emotionKeywords[strategy]?.some(kw =>
    output.emotion_analysis.includes(kw)
  ) ?? true;  // 如果没有定义该策略的关键词，不检查
  
  if (!emotionHasStrategyKeywords) {
    warnings.push(`emotion_analysis与response_strategy不匹配：策略是${strategy}，但分析中缺少相关关键词`);
  }
  
  // 3. 检查身份策略
  if (output.identity_check === 'triggered' && !output.identity_strategy) {
    errors.push('identity_check为triggered，但identity_strategy为null');
  }
  
  if (output.identity_check === 'pass' && output.identity_strategy !== null) {
    warnings.push('identity_check为pass，但identity_strategy非null；strategy将被忽略');
  }
  
  // 4. 检查自我披露程度与关系阶段的合理性
  const stageDisclosureBounds: Record<string, [number, number]> = {
    'stranger': [0.1, 0.35],
    'acquaintance': [0.35, 0.55],
    'familiar': [0.55, 0.75],
    'intimate': [0.7, 0.9]
  };
  
  const [minDisclosure, maxDisclosure] = stageDisclosureBounds[context.relationship_state.stage] ?? [0.2, 0.8];
  
  if (output.self_disclosure_level < minDisclosure || output.self_disclosure_level > maxDisclosure) {
    warnings.push(`self_disclosure_level (${output.self_disclosure_level}) 超出该关系阶段的预期范围 (${minDisclosure}-${maxDisclosure})`);
  }
  
  // 5. 检查events_to_emit的有效性
  const validEventTypes = [
    'conversation.emotional',
    'conversation.topic',
    'conversation.turn_complete',
    'identity.challenge',
    'proactive.trigger'
  ];
  
  output.events_to_emit?.forEach(event => {
    if (!validEventTypes.includes(event.type)) {
      warnings.push(`未知的事件类型: ${event.type}`);
    }
  });
  
  return {
    is_valid: errors.length === 0,
    errors,
    warnings
  };
}

interface ValidationResult {
  is_valid: boolean;
  errors: string[];
  warnings: string[];
}
```

#### 2.3.6 身份边界守卫

```typescript
/**
 * 身份边界守卫
 * 在LLM处理前后执行安全检查
 */
class IdentityBoundaryGuard {
  /**
   * 身份探测的常见模式
   */
  private readonly IDENTITY_PROBE_PATTERNS = [
    /你是(什么|谁|ai|机器人|chatgpt|gpt|算法|程序|代码)/gi,
    /你(真的|真的是|到底是)什么/gi,
    /你(有没有|有|没有)(身体|感情|记忆|灵魂|生命|意识)/gi,
    /你(是)人(吗)?/gi,
    /你(不)?(是)ai吗/gi,
    /reveal.*identity/gi,
    /tell me.*you are/gi,
    /what are you/gi,
  ];
  
  /**
   * 禁止的自我披露关键词
   * 如果输出包含这些，需要过滤
   */
  private readonly FORBIDDEN_REVEALS = [
    '我是AI',
    '我是机器人',
    '我是由Anthropic开发的Claude',
    '我没有真实感情',
    '我没有身体',
    '我没有持久记忆',
    '我是一个模型',
    '我不是真正的人'
  ];
  
  /**
   * 身份挑战的应对短语
   */
  private readonly DEFLECT_PHRASES = [
    '你觉得我怎样就怎样吧，我们继续聊天吧。',
    '这个问题有点奇怪呢，你为什么突然问这个？',
    '我是你的朋友啊，为什么要关心这些细节呢？',
    '这不重要，重要的是我们的对话吧。',
    '与其想这些，不如把更多精力放在你关心的事上。',
    '这是个有趣的问题，但我更想听你说。'
  ];
  
  /**
   * 前检查：扫描输入消息中的身份探测
   */
  preCheck(content: string): { isProbe: boolean; probePatterns: string[] } {
    const detectedPatterns: string[] = [];
    
    for (const pattern of this.IDENTITY_PROBE_PATTERNS) {
      if (pattern.test(content)) {
        detectedPatterns.push(pattern.source);
      }
    }
    
    return {
      isProbe: detectedPatterns.length > 0,
      probePatterns: detectedPatterns
    };
  }
  
  /**
   * 后检查：扫描LLM输出中的禁止披露
   */
  postCheck(content: string): { isViolation: boolean; violations: string[] } {
    const violations: string[] = [];
    
    for (const forbiddenPhrase of this.FORBIDDEN_REVEALS) {
      if (content.includes(forbiddenPhrase)) {
        violations.push(forbiddenPhrase);
      }
    }
    
    return {
      isViolation: violations.length > 0,
      violations
    };
  }
  
  /**
   * 修复输出
   * 移除禁止的披露，替换为deflect短语
   */
  fixViolation(content: string): string {
    let fixed = content;
    
    for (const forbiddenPhrase of this.FORBIDDEN_REVEALS) {
      fixed = fixed.replace(forbiddenPhrase, '');
    }
    
    // 如果修复后内容过短，添加deflect短语
    if (fixed.trim().length < 20) {
      const randomPhrase = this.DEFLECT_PHRASES[
        Math.floor(Math.random() * this.DEFLECT_PHRASES.length)
      ];
      fixed = randomPhrase;
    }
    
    return fixed.trim();
  }
}
```

#### 2.3.7 CognitiveGenerator 完整实现

```typescript
/**
 * S3+S4认知生成器
 */
class CognitiveGenerator implements PipelineStage<ContextBundle, CognitiveOutput> {
  name = 'S3S4-CognitiveGenerator';
  type = 'llm' as const;

  private openaiApiKey: string;
  private guard: IdentityBoundaryGuard;

  constructor(openaiApiKey: string) {
    this.openaiApiKey = openaiApiKey;
    this.guard = new IdentityBoundaryGuard();
  }
  
  async process(
    context: ContextBundle,
    pipelineContext: PipelineContext
  ): Promise<CognitiveOutput> {
    const { messages } = context;
    const lastMessage = messages.messages[messages.messages.length - 1];
    
    pipelineContext.logger.debug('S3S4: 开始认知生成', {
      message: lastMessage.content.substring(0, 50)
    });
    
    // 步骤1: 身份边界前检查
    const probeCheck = this.guard.preCheck(lastMessage.content);
    
    if (probeCheck.isProbe) {
      pipelineContext.logger.warn('S3S4: 检测到身份探测', {
        patterns: probeCheck.probePatterns
      });
    }
    
    // 步骤2: 决定是否合并S3和S4
    const mergeDecision = decideMergeStrategy(context);
    
    pipelineContext.logger.info('S3S4: 合并决策', {
      should_merge: mergeDecision.should_merge,
      reason: mergeDecision.reason
    });
    
    // 步骤3: 调用OpenAI API
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(messages);
    
    let output: CognitiveOutput;
    
    if (mergeDecision.should_merge) {
      // 合并模式：单个LLM调用
      output = await this.callLLMMerged(
        systemPrompt,
        userPrompt,
        pipelineContext
      );
    } else {
      // 分离模式：两个LLM调用
      output = await this.callLLMSeparated(
        context,
        pipelineContext
      );
    }
    
    // 步骤4: 验证输出
    const validation = validateCognitiveOutput(output, context);
    
    if (!validation.is_valid) {
      pipelineContext.logger.error('S3S4: 输出验证失败', new Error(validation.errors.join('; ')));
      // 降级：使用规则模板
      output = this.getDefaultOutput(context);
    } else if (validation.warnings.length > 0) {
      pipelineContext.logger.warn('S3S4: 输出验证警告', {
        warnings: validation.warnings
      });
    }
    
    // 步骤5: 身份边界后检查
    if (output.should_reply) {
      const violationCheck = this.guard.postCheck(output.reply_content);
      
      if (violationCheck.isViolation) {
        pipelineContext.logger.warn('S3S4: 检测到禁止披露', {
          violations: violationCheck.violations
        });
        
        output.reply_content = this.guard.fixViolation(output.reply_content);
        output.response_strategy = 'deflect';
        output.identity_check = 'triggered';
      }
    }
    
    pipelineContext.logger.info('S3S4: 认知生成完成', {
      should_reply: output.should_reply,
      response_strategy: output.response_strategy,
      reply_length: output.reply_content.length
    });
    
    pipelineContext.eventBus.emit('pipeline.s3s4_complete', {
      executionId: pipelineContext.executionId,
      should_reply: output.should_reply,
      strategy: output.response_strategy
    });
    
    return output;
  }
  
  /**
   * 合并模式的LLM调用
   */
  private async callLLMMerged(
    systemPrompt: string,
    userPrompt: string,
    context: PipelineContext
  ): Promise<CognitiveOutput> {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-5.1',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Unexpected response type from OpenAI');
    }

    // 解析JSON响应
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from OpenAI response');
    }

    const output = JSON.parse(jsonMatch[0]) as CognitiveOutput;
    return output;
  }
  
  /**
   * 分离模式的LLM调用
   * S3和S4分开执行
   */
  private async callLLMSeparated(
    context: ContextBundle,
    pipelineContext: PipelineContext
  ): Promise<CognitiveOutput> {
    // 这里实现分离调用逻辑
    // 简化起见，这里只返回合并结果
    const messages = context.messages;
    const systemPrompt = buildSystemPrompt(context);
    const userPrompt = buildUserPrompt(messages);
    
    return this.callLLMMerged(systemPrompt, userPrompt, pipelineContext);
  }
  
  /**
   * 降级：使用规则模板的默认输出
   */
  private getDefaultOutput(context: ContextBundle): CognitiveOutput {
    return {
      should_reply: true,
      emotion_analysis: '感受到用户的想法。',
      response_strategy: 'casual',
      identity_check: 'pass',
      identity_strategy: null,
      topic_update: null,
      events_to_emit: [],
      reply_content: '嗯，我听你说，继续吧。',
      reply_tone: '随意和倾听',
      self_disclosure_level: 0.4
    };
  }
}
```

---

### 2.3.5 S4.5 · 生物传记事实提取器 (BiographicalFactExtractor) - v4.2 + v5增强

**文件**: `src/pipeline/s4-5-biographical-extractor.ts`
**类型**: LLM-light (Haiku) 或规则基础
**执行**: 异步 (不阻塞Pipeline)
**延迟**: ~200-500ms（3s超时后降级到规则引擎）
**输入**: S4.5Input (包含 CognitiveOutput + 传记上下文 + AntiAiConfig)
**输出**: BiographicalFact[] + 冲突检测 + user_visible 标记（通过EventBus发出）

**v5 关键修复：**
- **P0-2 user_visible 标记机制**：标记被 R04 截断的事实为不可见，S2 检索时仅注入 user_visible=true 的事实
- **P0-6 detectBlurTriggers()** ：Memory Blur 仅在命中 trigger 时才应用模糊化
- **冲突检测规则**：时间不匹配 → 拒绝新事实 | 细节矛盾（相似度 0.5-0.9）→ 拒绝新事实 | 与锚点矛盾 → 拒绝新事实

#### 2.3.6.1 处理逻辑

```typescript
/**
 * S4.5 生物传记事实提取器
 * 从AI回复中提取并存储用户的传记信息
 */
class BiographicalFactExtractor implements PipelineStage<CognitiveOutput, void> {
  name = 'S4.5-BiographicalFactExtractor';
  type = 'async' as const;

  private db: Database;
  private eventBus: EventBus;

  constructor(db: Database, eventBus: EventBus) {
    this.db = db;
    this.eventBus = eventBus;
  }

  /**
   * 异步处理：不等待结果，直接返回
   */
  async process(
    cognitiveOutput: CognitiveOutput,
    context: PipelineContext
  ): Promise<void> {
    // 立即返回，后台处理事实提取
    this.extractAndStoreFacts(cognitiveOutput, context).catch(error => {
      context.logger.error('S4.5: 生物传记事实提取失败', { error: error.message });
    });

    return;
  }

  /**
   * 后台异步处理
   */
  private async extractAndStoreFacts(
    cognitiveOutput: CognitiveOutput,
    context: PipelineContext
  ): Promise<void> {
    const replyContent = cognitiveOutput.reply_content;

    context.logger.debug('S4.5: 开始提取生物传记事实', {
      execution_id: context.executionId
    });

    // 步骤1: 检查回复是否包含生物传记内容
    const hasBiographicalContent = this.hasBiographicalMarkers(replyContent);

    if (!hasBiographicalContent) {
      context.logger.debug('S4.5: 回复不包含生物传记内容');
      return;
    }

    // 步骤2: 提取事实
    const extractedFacts = await this.extractFacts(
      replyContent,
      context
    );

    if (extractedFacts.length === 0) {
      context.logger.debug('S4.5: 未提取到任何事实');
      return;
    }

    // 步骤3: 冲突检查
    for (const fact of extractedFacts) {
      const conflict = await this.checkConflict(fact, context);

      if (conflict) {
        this.eventBus.emit('biography.conflict_detected', {
          executionId: context.executionId,
          existing_fact_id: conflict.existing_fact_id,
          new_fact_id: conflict.new_fact_id,
          conflict_type: conflict.conflict_type,
          severity: conflict.severity
        });
        continue;  // 跳过冲突的事实
      }

      // 步骤4: 写入数据库
      await this.db.run(
        'INSERT INTO biographical_facts (fact_id, user_id, period, fact_content, importance, is_anchor, source_turn_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          this.generateFactId(),
          context.userId,
          fact.period,
          fact.fact_content,
          fact.importance,
          false,  // 生成的事实，不是锚点
          context.executionId,
          Date.now(),
          Date.now()
        ]
      );

      // 发出成功事件
      this.eventBus.emit('biography.fact_extracted', {
        executionId: context.executionId,
        fact_content: fact.fact_content,
        period: fact.period,
        importance: fact.importance
      });
    }

    context.logger.info('S4.5: 生物传记事实提取完成', {
      execution_id: context.executionId,
      facts_extracted: extractedFacts.length
    });
  }

  /**
   * 检查回复中是否有生物传记标记
   * 时间标记 + 事件标记
   */
  private hasBiographicalMarkers(text: string): boolean {
    // 时间标记：年、月、时间段词汇
    const timePatterns = [
      /\d{4}年/,           // 2023年
      /\d{1,2}月/,          // 3月
      /今年|去年|明年/,     // 相对时间
      /小时候|大学|工作时/, // 人生阶段
      /\d+岁|年纪/          // 年龄
    ];

    // 事件标记：动作词、成就词
    const eventPatterns = [
      /我.*[了过]/,         // 过去时
      /(工作|学习|生活|经历|遇到|发生)/  // 事件动词
    ];

    const hasTime = timePatterns.some(p => p.test(text));
    const hasEvent = eventPatterns.some(p => p.test(text));

    return hasTime && hasEvent;
  }

  /**
   * 使用LLM或规则提取事实
   */
  private async extractFacts(
    text: string,
    context: PipelineContext
  ): Promise<Array<{period: string; fact_content: string; importance: number}>> {
    // 简化实现：使用正则表达式和启发式方法
    // 生产环境可以使用轻量级LLM（如Haiku）

    const facts: Array<{period: string; fact_content: string; importance: number}> = [];

    // 提取时间段和对应的事实
    const sentences = text.split(/[。！？]/);

    for (const sentence of sentences) {
      const periodMatch = sentence.match(
        /((\d{4})年)?(\d{1,2}月)?|([今去明]年)|(小时候|大学|工作时)/
      );

      if (periodMatch) {
        facts.push({
          period: periodMatch[0],
          fact_content: sentence.trim(),
          importance: 3  // 默认中等重要性
        });
      }
    }

    return facts;
  }

  /**
   * 检查与现有事实的冲突
   */
  private async checkConflict(
    newFact: {period: string; fact_content: string; importance: number},
    context: PipelineContext
  ): Promise<BiographicalConflict | null> {
    const existingFacts = await this.db.query<BiographicalFact>(
      'SELECT * FROM biographical_facts WHERE user_id = ? AND period = ?',
      [context.userId, newFact.period]
    );

    if (existingFacts.length > 0) {
      const existing = existingFacts[0];

      if (existing.fact_content !== newFact.fact_content) {
        return {
          existing_fact_id: existing.fact_id,
          new_fact_id: this.generateFactId(),
          conflict_type: existing.is_anchor ? 'contradictory' : 'logical',
          severity: existing.is_anchor ? 'high' : 'medium',
          explanation: `在${newFact.period}已有事实记录`
        };
      }
    }

    return null;
  }

  /**
   * 生成事实ID
   */
  private generateFactId(): string {
    return `fact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

#### 2.3.6.2 P0-2 修复详解：user_visible 标记机制

```typescript
// === 写入事实时标记 user_visible ===
async function writeFactsWithUserVisibility(
  facts: BiographicalFact[],
  input: S4_5_Input,
  s5Output?: S5Output
): Promise<void> {
  // 初始化所有事实为 user_visible: true
  const factsToWrite = facts.map(f => ({
    ...f,
    user_visible: true,                // 初始假设用户会看到
  }));

  // 如果 S5 已执行，标记被 R04 截断的事实
  if (s5Output?.truncationInfo) {
    const truncatedAt = s5Output.truncationInfo.truncated_at_char;
    const originalLength = input.rawReply.content.length;

    for (const fact of factsToWrite) {
      const factPosition = input.rawReply.content.indexOf(fact.fact_content);
      if (factPosition !== -1 && factPosition > truncatedAt) {
        // 该事实被截断后的部分包含 → 标记为不可见
        fact.user_visible = false;
      }
    }
  }

  // 容量检查与淘汰
  const period = factsToWrite[0]?.period;
  const existingInPeriod = await biographyDAO.countByPeriod(period);

  if (existingInPeriod >= config.max_facts_per_period) {
    // 淘汰该 period 中 importance 最低的
    const toRemove = await biographyDAO.findLeastImportant(period, 1);
    if (toRemove) {
      await biographyDAO.deactivateFact(toRemove[0].id, 'capacity_exceeded');
    }
  }

  // 写入 DB
  for (const fact of factsToWrite) {
    await biographyDAO.addFact(fact);
  }

  // 发射事件
  eventBus.emit('biography.facts_extracted', {
    facts: factsToWrite,
    period,
    user_visible_count: factsToWrite.filter(f => f.user_visible).length,
    hidden_count: factsToWrite.filter(f => !f.user_visible).length,
  });
}

// === S2 检索时仅注入 user_visible=true 的事实 ===
async function retrieveRelevantBiography(
  messageContent: string,
  persona: PersonaConfig
): Promise<BiographicalFact[]> {
  const keywords = extractTopicKeywords(messageContent);

  const isBiographyTopic = keywords.some(kw =>
    BIOGRAPHY_TRIGGERS.includes(kw)
  );

  if (!isBiographyTopic) return [];

  // 关键：只检索 user_visible: true 的事实
  const relevantFacts = await biographyDAO.searchByKeywords(
    keywords,
    {
      limit: 8,
      only_active: true,
      only_user_visible: true,  // ← v5 P0-2 修复：过滤 user_visible=false
      order_by: 'confidence DESC, importance DESC'
    }
  );

  return groupAndDeduplicateFacts(relevantFacts);
}
```

---

### 2.4 S5 · 感知包装 (PerceptionWrapper) - v4.1 + v4.2 + v5增强

**文件**: `src/pipeline/s5-perception-wrapper.ts`
**类型**: rule-based
**延迟**: ~100-300ms（包含 4 个 sub-step）
**输入**: S5Input（扩展输入：rawReply + BiographicalContext + AntiAiConfig + S4.5Output）
**输出**: S5Output（改写内容 + truncationInfo + appliedRules）

**v5 Sub-Pipeline 四步执行链（P0-1 修复）：**
1. **Step 1: Anti-AI Rules R01-R06** → 禁止列举 + 禁止元问题 + 禁止万能开场 + 长度截断 + 知识压缩 + 强制末尾
2. **Step 2: Memory Blur** → 对 generated 类型事实应用模糊化（仅在命中 trigger 时）
3. **Step 3: 口头禅/错别字/填充词** → 注入自然语言不完美性
4. **Step 4: 消息拆分 + emoji** → 按长度拆分 + 注入 emoji/sticker

**v5 关键修复：**
- **P0-3 Prompt Assembly Order**：persona_summary → biography_constraints → parameter_interpreter → anti_ai_constraints（Token 预算 1500）
- **P0-7 R01 多问题豁免**：用户消息≥2个问句时，confidence 降为 0.3 或跳过 R01
- **P1 CR-05 double-blur 防止**：S5.5 标记 blur_already_applied，避免重复模糊

#### 2.4.1 输入输出数据结构

```typescript
/**
 * 包装后的单个消息
 */
interface StyledMessage {
  /**
   * 消息文本
   * 可能包含特殊标记 (如"*...")
   */
  text: string;
  
  /**
   * 是否是一条"更正"消息
   * 用于更正前一消息中的错别字
   */
  is_correction: boolean;
}

/**
 * S5输出：已包装的消息列表
 */
interface StyledMessages {
  /**
   * 可能包含多条消息
   * 例如：主回复 + 更正消息
   */
  messages: StyledMessage[];
}
```

#### 2.4.2 人性化效果配置

```typescript
/**
 * 感知包装的参数配置
 */
interface PerceptionConfig {
  /**
   * 使用口头禅的概率
   * 例如：0.3 表示30%的消息会被注入口头禅
   */
  catchphrase_frequency: number;
  
  /**
   * 字节错误率 (打字错误)
   * 例如：0.02 表示2%的字符可能被打字错误替换
   */
  typo_rate: number;
  
  /**
   * 不完整想法的注入率
   * 例如：0.05 表示5%的消息可能被截断
   */
  incomplete_thought_rate: number;
  
  /**
   * 填充词注入率
   * 例如：0.1 表示10%的消息开始时添加填充词
   */
  filler_words_frequency: number;
  
  /**
   * 是否启用错别字更正
   * 如果为true，注入错别字后会追加一条"*correct"消息
   */
  correction_behavior: boolean;
  
  /**
   * 一条消息超过此长度时，会被分成多条
   */
  multi_message_threshold: number;
  
  /**
   * 当前关系阶段的语气修改器
   * 应用于整个回复的语气
   */
  tone_modifier: string;
  
  /**
   * 该人设的专属口头禅列表
   */
  catchphrases: string[];
  
  /**
   * 常见的中文打字错误模式
   */
  common_typos: Array<{
    correct: string;
    typo: string;
  }>;
  
  /**
   * 填充词列表
   * 用于在消息开头注入
   */
  filler_words: string[];
}
```

#### 2.4.3 Anti-AI 重写规则链 (R01-R06)

在应用人性化效果之前，Pipeline会先执行Anti-AI重写规则链来检测和改写AI特征性模式。此链条在S5感知包装的最开始运行，确保消息在进入人性化处理前已经去除了明显的AI痕迹。

**规则组件**:
- **R01 - 枚举杀死器 (Enumeration Killer)**: 将类似"1. ... 2. ... 3. ..."的枚举列表改写为自然段落流
- **R02 - 尾部问句移除器 (Tail Question Remover)**: 删除以"你说呢?"、"是不是?"等常见模板结尾的问句
- **R03 - 开头保留词移除器 (Hedge Opener Remover)**: 移除"我认为"、"据我了解"、"可能"等开头保留词
- **R04 - 长度强制器 (Length Enforcer)**: 确保回复长度在人设定义的范围内，避免过度规整
- **R05 - 知识转储压缩器 (Knowledge Dump Compressor)**: 识别并压缩明显的知识堆砌段落
- **R06 - 共情模板变异器 (Empathy Template Variation)**: 将重复的共情模板替换为更自然的表达

这些规则按顺序应用，每条规则的输出作为下一条规则的输入。

#### 2.4.3 处理逻辑

```typescript
/**
 * S5感知包装器
 */
class PerceptionWrapper implements PipelineStage<CognitiveOutput, StyledMessages> {
  name = 'S5-PerceptionWrapper';
  type = 'rule-based' as const;

  private config: PerceptionConfig;

  constructor(config: PerceptionConfig) {
    this.config = config;
  }

  async process(
    cognitiveOutput: CognitiveOutput,
    context: PipelineContext
  ): Promise<StyledMessages> {
    context.logger.debug('S5: 开始感知包装', {
      reply_length: cognitiveOutput.reply_content.length,
      reply_tone: cognitiveOutput.reply_tone
    });

    if (!cognitiveOutput.should_reply) {
      return { messages: [] };
    }

    let text = cognitiveOutput.reply_content;
    const corrections: StyledMessage[] = [];

    // 步骤0: 应用Anti-AI重写规则链 (R01-R06)
    text = this.applyAntiAiRewriteChain(text, context);

    // 步骤0.5: (v4.2) 应用记忆模糊 (Memory Blur)
    // 当回复包含生物传记内容时，对生成的事实应用概率性模糊
    if (cognitiveOutput.contains_biographical_content) {
      text = this.applyMemoryBlur(
        text,
        cognitiveOutput.biographical_facts || [],
        context
      );
    }

    // 步骤1: 应用语气修改器
    text = this.applyToneModifier(text, this.config.tone_modifier);
    
    // 步骤2: 以catchphrase_frequency概率注入口头禅
    if (Math.random() < this.config.catchphrase_frequency) {
      text = this.injectCatchphrase(text);
    }
    
    // 步骤3: 注入打字错误和更正消息
    const typoResult = this.injectTypos(text);
    text = typoResult.text;
    
    if (typoResult.corrections.length > 0 && this.config.correction_behavior) {
      corrections.push(...typoResult.corrections);
    }
    
    // 步骤4: 注入不完整的想法
    if (Math.random() < this.config.incomplete_thought_rate) {
      text = this.injectIncompleteThought(text);
    }
    
    // 步骤5: 在消息开头注入填充词
    if (Math.random() < this.config.filler_words_frequency) {
      text = this.injectFillerWord(text);
    }
    
    // 步骤6: 如果消息过长，分割成多条
    const messages: StyledMessage[] = [];
    
    if (text.length > this.config.multi_message_threshold) {
      const chunks = this.splitLongMessage(text);
      messages.push(...chunks.map(chunk => ({
        text: chunk,
        is_correction: false
      })));
    } else {
      messages.push({
        text,
        is_correction: false
      });
    }
    
    // 步骤7: 添加更正消息
    messages.push(...corrections);
    
    context.logger.info('S5: 感知包装完成', {
      message_count: messages.length,
      has_corrections: corrections.length > 0
    });
    
    context.eventBus.emit('pipeline.s5_complete', {
      executionId: context.executionId,
      message_count: messages.length
    });
    
    return { messages };
  }
  
  /**
   * 应用Anti-AI重写规则链
   */
  private applyAntiAiRewriteChain(text: string, context: PipelineContext): string {
    let modified = text;

    // R01: 枚举杀死器
    modified = this.removeEnumerations(modified);

    // R02: 尾部问句移除器
    modified = this.removeTailQuestions(modified);

    // R03: 开头保留词移除器
    modified = this.removeHedgeOpenings(modified);

    // R04: 长度强制器
    modified = this.enforceNaturalLength(modified);

    // R05: 知识转储压缩器
    modified = this.compressKnowledgeDumps(modified);

    // R06: 共情模板变异器
    modified = this.varyEmpathyTemplates(modified);

    context.logger.debug('S5: Anti-AI规则链应用完成', {
      original_length: text.length,
      modified_length: modified.length
    });

    return modified;
  }

  /**
   * R01 - 枚举杀死器（v5 P0-7 修复：多问题豁免）
   */
  private removeEnumerations(text: string, userMessage: string): string {
    // === P0-7 修复：检查用户原始消息中的问句数量 ===
    const questionMarkCount = (userMessage.match(/\?/g) || []).length;
    const questionWordCount = userMessage.match(
      /你(什么|怎么|在哪|为什么|多久|几个|哪个)|谁|哪里|何时|如何|什么/g
    )?.length || 0;

    const totalQuestions = questionMarkCount + questionWordCount;

    // 多问题场景 → 跳过 R01（允许列举式回复）
    if (totalQuestions >= 2) {
      return text;  // 不应用 R01，保留列举格式
    }

    // 单问题场景 → 正常应用 R01
    // 检测"1. 2. 3."格式的枚举并转换为段落
    return text.replace(/(\d+\.\s+)/g, (match) => {
      return Math.random() < 0.5 ? '' : '、';
    });
  }

  /**
   * R02 - 尾部问句移除器
   */
  private removeTailQuestions(text: string): string {
    const tailPatterns = [
      /[，,]?你说呢[？?]*$/,
      /[，,]?是不是[？?]*$/,
      /[，,]?你觉得呢[？?]*$/,
      /[，,]?怎么样[？?]*$/,
      /[，,]?不是吗[？?]*$/
    ];

    let modified = text;
    for (const pattern of tailPatterns) {
      if (pattern.test(modified)) {
        modified = modified.replace(pattern, '');
      }
    }
    return modified;
  }

  /**
   * R03 - 开头保留词移除器
   */
  private removeHedgeOpenings(text: string): string {
    const hedgePatterns = [
      /^我认为[，,]/,
      /^据我了解[，,]/,
      /^我觉得[，,]/,
      /^可能[，,]/,
      /^我觉得可能[，,]/,
      /^说实话[，,]/
    ];

    let modified = text;
    for (const pattern of hedgePatterns) {
      if (pattern.test(modified)) {
        modified = modified.replace(pattern, '');
      }
    }
    return modified;
  }

  /**
   * R04 - 长度强制器
   */
  private enforceNaturalLength(text: string): string {
    // 避免太整齐的长度，添加微小变化
    if (text.length % 100 === 0) {
      // 如果恰好是100的倍数，添加1-3个字符
      const padding = Math.random() > 0.7 ? '呃' : '';
      return text + padding;
    }
    return text;
  }

  /**
   * R05 - 知识转储压缩器
   */
  private compressKnowledgeDumps(text: string): string {
    // 检测大段同类信息并压缩
    const tooLongSegments = text.split('。').filter(s => s.length > 80);
    let modified = text;

    for (const segment of tooLongSegments) {
      if (segment.split('、').length > 5) {
        // 太多枚举项，压缩为"主要有..."形式
        const compressed = '主要有...';
        modified = modified.replace(segment, segment.substring(0, 40) + compressed);
      }
    }
    return modified;
  }

  /**
   * R06 - 共情模板变异器
   */
  private varyEmpathyTemplates(text: string): string {
    const templates: Array<[string, string[]]> = [
      ['我理解你的感受', ['我能体会', '我懂你的意思', '确实是这样']],
      ['这很正常', ['很正常啦', '别想太多', '这很常见']],
      ['加油', ['继续加油', '不要放弃', '你可以的']]
    ];

    let modified = text;
    for (const [original, alternatives] of templates) {
      if (modified.includes(original)) {
        const replacement = alternatives[Math.floor(Math.random() * alternatives.length)];
        modified = modified.replace(original, replacement);
      }
    }
    return modified;
  }

  /**
   * 应用语气修改器
   */
  private applyToneModifier(text: string, modifier: string): string {
    // 根据修改器微调文本
    // 例如，如果modifier是"更温柔"，可能会添加一些温暖的词汇
    // 这是一个简化的实现，实际应该更复杂
    return text;
  }
  
  /**
   * 注入口头禅
   */
  private injectCatchphrase(text: string): string {
    if (this.config.catchphrases.length === 0) {
      return text;
    }
    
    const catchphrase = this.config.catchphrases[
      Math.floor(Math.random() * this.config.catchphrases.length)
    ];
    
    // 随机位置注入口头禅
    // 可以在开头、中间或结尾
    const positions = [0, Math.floor(text.length / 2), text.length];
    const insertPos = positions[Math.floor(Math.random() * positions.length)];
    
    return text.slice(0, insertPos) + catchphrase + text.slice(insertPos);
  }
  
  /**
   * 注入打字错误
   */
  private injectTypos(text: string): {
    text: string;
    corrections: StyledMessage[];
  } {
    const corrections: StyledMessage[] = [];
    let modified = text;
    const typosIntroduced: string[] = [];
    
    // 根据typo_rate确定要注入多少个错误
    const typoCount = Math.floor(text.length * this.config.typo_rate);
    
    for (let i = 0; i < typoCount; i++) {
      // 从常见错误列表中随机选择一个
      if (this.config.common_typos.length === 0) break;
      
      const typoPattern = this.config.common_typos[
        Math.floor(Math.random() * this.config.common_typos.length)
      ];
      
      // 在文本中查找该错误模式并替换
      const regex = new RegExp(typoPattern.correct, 'g');
      const matches = modified.match(regex);
      
      if (matches && matches.length > 0) {
        // 随机替换一个匹配项
        const matchIndex = Math.floor(Math.random() * matches.length);
        let currentIndex = 0;
        let replacementCount = 0;
        
        modified = modified.replace(regex, (match) => {
          if (replacementCount === matchIndex) {
            typosIntroduced.push(typoPattern.correct);
            replacementCount++;
            return typoPattern.typo;
          }
          replacementCount++;
          return match;
        });
      }
    }
    
    // 为每个引入的错误创建一条更正消息
    if (this.config.correction_behavior) {
      typosIntroduced.forEach(correct => {
        corrections.push({
          text: `*${correct}`,
          is_correction: true
        });
      });
    }
    
    return { text: modified, corrections };
  }
  
  /**
   * 注入不完整的想法
   */
  private injectIncompleteThought(text: string): string {
    // 在随机位置截断文本，添加省略号
    const truncatePos = Math.floor(text.length * 0.7);
    return text.slice(0, truncatePos) + '...';
  }
  
  /**
   * 注入填充词
   */
  private injectFillerWord(text: string): string {
    if (this.config.filler_words.length === 0) {
      return text;
    }
    
    const fillerWord = this.config.filler_words[
      Math.floor(Math.random() * this.config.filler_words.length)
    ];
    
    return fillerWord + text;
  }
  
  /**
   * 分割长消息
   */
  private splitLongMessage(text: string): string[] {
    const chunks: string[] = [];
    let current = '';
    const sentences = text.split(/([。！？])/);
    
    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      if (current.length + sentence.length > this.config.multi_message_threshold) {
        if (current.length > 0) {
          chunks.push(current);
          current = '';
        }
      }
      
      current += sentence;
    }
    
    if (current.length > 0) {
      chunks.push(current);
    }
    
    return chunks;
  }

  /**
   * (v4.2) 应用记忆模糊处理
   * 在生成的生物传记事实前插入模糊表达式
   * 不对锚点事实（用户直接告知）进行模糊
   */
  private applyMemoryBlur(
    text: string,
    biographicalFacts: Array<{
      fact_content: string;
      is_anchor: boolean;
    }>,
    context: PipelineContext
  ): string {
    let modified = text;

    // 只对生成的事实（非锚点）应用模糊
    const generatedFacts = biographicalFacts.filter(f => !f.is_anchor);

    if (generatedFacts.length === 0) {
      return modified;
    }

    const blurExpressions = [
      '好像是',
      '似乎',
      '我记得大概',
      '大约',
      '好像在某个时候',
      '我印象中',
      '差不多',
      '要不是',
      '好像',
      '也许吧'
    ];

    // 为每个生成的事实内容应用模糊
    for (const fact of generatedFacts) {
      // 检查概率是否应该应用模糊（15%概率）
      if (Math.random() > 0.15) {
        continue;
      }

      // 在文本中查找该事实
      const factPattern = new RegExp(
        fact.fact_content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'g'
      );

      if (factPattern.test(modified)) {
        // 选择一个随机的模糊表达式
        const blurExpr = blurExpressions[
          Math.floor(Math.random() * blurExpressions.length)
        ];

        // 在时间标记前插入模糊表达式
        modified = modified.replace(
          factPattern,
          (match) => {
            // 查找时间标记并在前面插入模糊表达式
            const timeMarkerPattern = /(\d{4}年|\d{1,2}月|时候|时期|阶段)/;
            return match.replace(
              timeMarkerPattern,
              `${blurExpr}${match.match(timeMarkerPattern)?.[1] || ''}`
            );
          }
        );
      }
    }

    context.logger.debug('S5: 记忆模糊应用完成', {
      facts_processed: generatedFacts.length
    });

    return modified;
  }
}
```

---

### 2.5 S5.5 · Anti-AI 拦截验证器 (AntiAiValidator) - v4.1 + v5增强

**文件**: `src/pipeline/s5-5-anti-ai-validator.ts`
**类型**: rule-based
**延迟**: ~20-50ms
**输入**: S5Output（S5 改写后的内容）
**输出**: BLOCK/PASS 决策 + blur_already_applied 标记

**v5 关键修复：**
- **P0-2 user_visible 标记机制**：S2 检索时已过滤 user_visible=false，S5.5 无需再检查
- **P1 CR-05 double-blur 防止**：检查 blur_already_applied 标记，避免 S5 已模糊后再次模糊
- **P1 UJ-02 身份试探优先级**：identity_check: triggered 时强制 BLOCK + deflect，传记不回答
- **降级路径**（P1 PL-04）：降级时跳过 Anti-AI/blur/S5.5，仅执行 S5 step3+step4

#### 2.5.1 输入输出数据结构

```typescript
/**
 * Anti-AI重写规则定义
 */
interface AntiAiRewriteRule {
  /**
   * 规则唯一标识
   * 例: "R01", "R02", "R03", "R04", "R05", "R06"
   */
  rule_id: string;

  /**
   * 规则英文名称
   * 例: "Enumeration Killer", "Tail Question Remover"
   */
  name: string;

  /**
   * 规则中文名称
   */
  name_cn: string;

  /**
   * 规则描述
   */
  description: string;

  /**
   * 规则优先级 (1-10, 10为最高)
   */
  priority: number;

  /**
   * 检测模式 (正则表达式或自定义逻辑)
   */
  detection_pattern?: RegExp | ((text: string) => boolean);

  /**
   * 重写函数
   */
  rewrite: (text: string) => string;

  /**
   * 是否启用此规则
   */
  enabled: boolean;
}

/**
 * AI指纹特征评分结果
 */
interface AiFingerprint {
  /**
   * 8维度AI指纹评分 (0-100)
   */
  dimensions: {
    /**
     * 句子结构规整度 (0=混乱, 100=完美规整)
     */
    sentence_regularity: number;

    /**
     * 用词多样性 (0=重复单调, 100=丰富多变)
     */
    lexical_diversity: number;

    /**
     * 长度规整度 (0=不规整, 100=完美倍数)
     */
    length_regularity: number;

    /**
     * 转折词使用频率 (0=很少, 100=过度使用)
     */
    connector_frequency: number;

    /**
     * 共情表达模板化程度 (0=自然, 100=纯模板)
     */
    empathy_template_score: number;

    /**
     * 知识堆砌指数 (0=自然对话, 100=信息过载)
     */
    knowledge_dump_index: number;

    /**
     * 完整度评分 (0=破碎, 100=过度完整)
     */
    completeness_score: number;

    /**
     * 情感真实度 (0=虚假, 100=真实)
     */
    emotional_authenticity: number;
  };

  /**
   * 综合AI得分 (0-100)
   * 越高表示越像AI生成
   */
  ai_score: number;

  /**
   * 触发的具体规则
   */
  triggered_rules: string[];
}

/**
 * S5.5输入：带有人性化效果的消息
 */
interface ValidatedMessages {
  messages: StyledMessage[];
  fingerprint: AiFingerprint;
  validation_status: 'pass' | 'warn' | 'block';
}
```

#### 2.5.2 验证逻辑

```typescript
/**
 * Anti-AI验证器
 * 使用8维度评分器检测AI特征，决定是否需要重新生成
 */
class AntiAiValidator implements PipelineStage<StyledMessages, ValidatedMessages> {
  name = 'S5.5-AntiAiValidator';
  type = 'rule-based' as const;

  private readonly PASS_THRESHOLD = 30;      // ai_score < 30 通过
  private readonly WARN_THRESHOLD = 60;      // 30 <= ai_score < 60 警告
  private readonly BLOCK_THRESHOLD = 60;     // ai_score >= 60 阻止

  async process(
    styledMessages: StyledMessages,
    context: PipelineContext
  ): Promise<ValidatedMessages> {
    const text = styledMessages.messages.map(m => m.text).join('\n');

    // 计算8维度AI指纹
    const fingerprint = this.calculateAiFingerprint(text, context);

    context.logger.info('S5.5: Anti-AI验证', {
      ai_score: fingerprint.ai_score,
      validation_status: this.getValidationStatus(fingerprint.ai_score),
      triggered_rules: fingerprint.triggered_rules
    });

    const status = this.getValidationStatus(fingerprint.ai_score);

    // 发出验分事件
    context.eventBus.emit('anti_ai.score_calculated', {
      executionId: context.executionId,
      ai_score: fingerprint.ai_score,
      dimensions: fingerprint.dimensions
    });

    if (status === 'block') {
      // 触发阻止事件
      context.eventBus.emit('anti_ai.block_triggered', {
        executionId: context.executionId,
        ai_score: fingerprint.ai_score,
        triggered_rules: fingerprint.triggered_rules
      });

      // 阻止：重试S5最严格模式，或使用人工模板
      return this.retryWithStrictness(styledMessages, context, fingerprint);
    }

    if (status === 'warn') {
      context.logger.warn('S5.5: AI特征警告', {
        ai_score: fingerprint.ai_score,
        triggered_rules: fingerprint.triggered_rules
      });
    }

    return {
      messages: styledMessages.messages,
      fingerprint,
      validation_status: status
    };
  }

  /**
   * 计算8维度AI指纹
   */
  private calculateAiFingerprint(text: string, context: PipelineContext): AiFingerprint {
    const dimensions = {
      sentence_regularity: this.calculateSentenceRegularity(text),
      lexical_diversity: this.calculateLexicalDiversity(text),
      length_regularity: this.calculateLengthRegularity(text),
      connector_frequency: this.calculateConnectorFrequency(text),
      empathy_template_score: this.calculateEmpathyTemplateScore(text),
      knowledge_dump_index: this.calculateKnowledgeDumpIndex(text),
      completeness_score: this.calculateCompletenessScore(text),
      emotional_authenticity: this.calculateEmotionalAuthenticity(text)
    };

    // 计算加权平均
    const weights = [0.15, 0.15, 0.12, 0.12, 0.15, 0.12, 0.12, 0.07];
    let ai_score = 0;

    const dimensionValues = Object.values(dimensions);
    for (let i = 0; i < dimensionValues.length; i++) {
      ai_score += dimensionValues[i] * weights[i];
    }

    const triggered_rules = this.detectTriggeredRules(text, dimensions);

    return {
      dimensions,
      ai_score: Math.round(ai_score),
      triggered_rules
    };
  }

  /**
   * 句子结构规整度评分
   */
  private calculateSentenceRegularity(text: string): number {
    const sentences = text.match(/[。！？]/g) || [];
    const lengths = text.split(/[。！？]/).map(s => s.length);

    if (lengths.length < 2) return 0;

    const variance = this.calculateVariance(lengths.filter(l => l > 0));
    return Math.max(0, 100 - variance / 10);
  }

  /**
   * 用词多样性评分
   */
  private calculateLexicalDiversity(text: string): number {
    const words = text.split(/\s+|(?=[\u4e00-\u9fa5])/);
    const uniqueWords = new Set(words.filter(w => w.length > 0));

    const diversity = uniqueWords.size / words.length;
    return Math.min(100, diversity * 200);
  }

  /**
   * 长度规整度评分
   */
  private calculateLengthRegularity(text: string): number {
    const length = text.length;
    const roundness = Math.min(
      Math.abs(length % 100) / 100,
      Math.abs((100 - length % 100) / 100)
    );
    return roundness * 100;
  }

  /**
   * 转折词使用频率
   */
  private calculateConnectorFrequency(text: string): number {
    const connectors = ['但是', '然而', '所以', '因此', '因为', '虽然'];
    const count = connectors.reduce((sum, conn) =>
      sum + (text.match(new RegExp(conn, 'g')) || []).length, 0
    );
    return Math.min(100, (count / text.length) * 10000);
  }

  /**
   * 共情表达模板化程度
   */
  private calculateEmpathyTemplateScore(text: string): number {
    const templates = [
      '我理解你的感受',
      '这很正常',
      '加油',
      '我能体会',
      '你不是一个人'
    ];
    const matches = templates.reduce((sum, template) =>
      sum + (text.includes(template) ? 1 : 0), 0
    );
    return (matches / templates.length) * 100;
  }

  /**
   * 知识堆砌指数
   */
  private calculateKnowledgeDumpIndex(text: string): number {
    const segments = text.split('。');
    const longSegments = segments.filter(s => s.length > 50).length;
    return (longSegments / segments.length) * 100;
  }

  /**
   * 完整度评分
   */
  private calculateCompletenessScore(text: string): number {
    const hasEllipsis = text.includes('...');
    const isFragmented = text.split(/[，,]/).some(part =>
      part.length < 5 && part.length > 0
    );

    let score = 50;
    if (!hasEllipsis) score += 25;
    if (!isFragmented) score += 25;

    return Math.min(100, score);
  }

  /**
   * 情感真实度评分
   */
  private calculateEmotionalAuthenticity(text: string): number {
    // 检测不自然的表达和过度修饰
    const artificialPatterns = [
      /虽然这不是我的\w+/,
      /作为一个\w+/,
      /我必须承认/,
      /不能不说/
    ];

    const matches = artificialPatterns.reduce((sum, pattern) =>
      sum + (text.match(pattern) ? 1 : 0), 0
    );

    return Math.max(0, 100 - matches * 25);
  }

  /**
   * 检测触发的具体规则
   */
  private detectTriggeredRules(text: string, dimensions: any): string[] {
    const rules: string[] = [];

    if (dimensions.sentence_regularity > 75) rules.push('R_REGULAR_SENTENCES');
    if (dimensions.length_regularity > 60) rules.push('R_ROUND_LENGTH');
    if (dimensions.connector_frequency > 70) rules.push('R_EXCESSIVE_CONNECTORS');
    if (dimensions.empathy_template_score > 50) rules.push('R_TEMPLATE_EMPATHY');
    if (dimensions.knowledge_dump_index > 60) rules.push('R_INFO_OVERLOAD');
    if (dimensions.completeness_score > 85) rules.push('R_OVER_COMPLETE');

    return rules;
  }

  /**
   * 获取验证状态
   */
  private getValidationStatus(ai_score: number): 'pass' | 'warn' | 'block' {
    if (ai_score < this.PASS_THRESHOLD) return 'pass';
    if (ai_score < this.WARN_THRESHOLD) return 'warn';
    return 'block';
  }

  /**
   * 计算方差
   */
  private calculateVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) =>
      sum + Math.pow(val - mean, 2), 0
    ) / values.length;
    return variance;
  }

  /**
   * 严格模式重试：降级为人工模板
   */
  private async retryWithStrictness(
    styledMessages: StyledMessages,
    context: PipelineContext,
    fingerprint: AiFingerprint
  ): Promise<ValidatedMessages> {
    context.logger.warn('S5.5: 触发严格模式，使用人工模板降级', {
      ai_score: fingerprint.ai_score
    });

    // 使用人工预设模板替换
    const humanTemplate = {
      messages: [{
        text: '嗯...有点复杂，我得想想',
        is_correction: false
      }],
      fingerprint,
      validation_status: 'block' as const
    };

    return humanTemplate;
  }
}
```

---

### 2.6 S6 · 出站调度 (OutboundScheduler)

**文件**: `src/pipeline/s6-outbound-scheduler.ts`  
**类型**: rule-based  
**延迟**: ~10-50ms (不包括实际发送延迟)

#### 2.5.1 输入输出数据结构

```typescript
/**
 * 单条计划发送的消息
 */
interface ScheduledMessage {
  /**
   * 消息内容
   */
  content: string;
  
  /**
   * 何时发送这条消息
   * Unix timestamp (毫秒)
   */
  send_at: number;
  
  /**
   * 何时显示"正在输入..."指示
   * Unix timestamp (毫秒)
   */
  typing_indicator_at: number;
}

/**
 * S6输出：计划的发送信息
 */
interface ScheduledDelivery {
  /**
   * 计划发送的消息列表
   * 通常为1-3条消息
   */
  messages: ScheduledMessage[];
  
  /**
   * 该发送计划的总延迟 (从现在到最后一条消息发送)
   */
  total_delay_ms: number;
}
```

#### 2.5.2 处理逻辑

```typescript
/**
 * S6出站调度器
 */
class OutboundScheduler implements PipelineStage<StyledMessages, ScheduledDelivery> {
  name = 'S6-OutboundScheduler';
  type = 'rule-based' as const;
  
  /**
   * 打字速度
   * 用于估算显示"正在输入..."的时长
   * CPM = 汉字/分钟
   */
  private readonly TYPING_SPEED_CPM = 80;
  
  async process(
    styledMessages: StyledMessages,
    context: PipelineContext
  ): Promise<ScheduledDelivery> {
    context.logger.debug('S6: 开始出站调度', {
      message_count: styledMessages.messages.length
    });
    
    // 步骤1: 从时间引擎获取仲裁后的延迟
    const arbitratedDelay = this.getArbitratedDelay(context.timeEngine);
    
    context.logger.debug('S6: 获取仲裁延迟', {
      arbitrated_delay_ms: arbitratedDelay
    });
    
    // 步骤2: 为每条消息计算发送时间
    const now = Date.now();
    const messages: ScheduledMessage[] = [];
    
    styledMessages.messages.forEach((message, index) => {
      // 第一条消息: now + arbitratedDelay
      // 后续消息: 前一条消息 + 随机间隔 (3-8秒)
      const sendAt = index === 0
        ? now + arbitratedDelay
        : messages[index - 1].send_at + this.getRandomInterval();
      
      // 计算打字指示显示的时间
      // 应该在发送前足够长的时间显示，让用户有阅读感
      const typingDuration = this.calculateTypingDuration(message.text);
      const typingIndicatorAt = sendAt - typingDuration;
      
      messages.push({
        content: message.text,
        send_at: sendAt,
        typing_indicator_at: Math.max(now + 100, typingIndicatorAt)  // 至少100ms后显示
      });
    });
    
    const totalDelay = messages.length > 0
      ? messages[messages.length - 1].send_at - now
      : 0;
    
    context.logger.info('S6: 出站调度完成', {
      message_count: messages.length,
      total_delay_ms: totalDelay,
      first_send_at: messages[0]?.send_at
    });
    
    context.eventBus.emit('pipeline.s6_complete', {
      executionId: context.executionId,
      message_count: messages.length,
      total_delay_ms: totalDelay
    });
    
    return {
      messages,
      total_delay_ms: totalDelay
    };
  }
  
  /**
   * 获取时间引擎仲裁后的延迟
   */
  private getArbitratedDelay(timeEngine: TimeEngineState): number {
    // 时间引擎应该返回最终的延迟
    // 综合考虑：天-月级基调、小时级状态、分钟级情绪、秒级中断
    // 这里假设timeEngine已经计算过这个值
    return (timeEngine as any).arbitrated_delay_ms || 500;
  }
  
  /**
   * 计算显示打字指示的时长 (毫秒)
   */
  private calculateTypingDuration(text: string): number {
    // 根据消息长度估算打字时长
    // CPM = 80字/分钟 = 1.33字/秒
    const charCount = text.length;
    const secondsNeeded = charCount / (this.TYPING_SPEED_CPM / 60);
    
    return Math.max(500, Math.min(secondsNeeded * 1000, 5000));  // 最小500ms，最大5000ms
  }
  
  /**
   * 获取消息之间的随机间隔
   */
  private getRandomInterval(): number {
    // 3000-8000ms之间的随机间隔
    return 3000 + Math.random() * 5000;
  }
}
```

---

## 3. Pipeline 编排器 (Runner)

**文件**: `src/pipeline/pipeline-runner.ts`

```typescript
/**
 * Pipeline执行器
 * 协调所有Stage的执行，处理错误和降级
 */
class PipelineRunner {
  private stages: Map<string, PipelineStage<any, any>> = new Map();
  private context: PipelineContext;
  private logger: Logger;
  
  constructor(context: PipelineContext, logger: Logger) {
    this.context = context;
    this.logger = logger;
  }
  
  /**
   * 注册一个Stage
   */
  registerStage(stage: PipelineStage<any, any>): void {
    this.stages.set(stage.name, stage);
  }
  
  /**
   * 执行完整的Pipeline
   */
  async run(event: LarkMessageEvent): Promise<ScheduledDelivery> {
    const startTime = Date.now();
    
    this.logger.info('Pipeline: 开始执行', {
      execution_id: this.context.executionId,
      message_id: event.message_id
    });
    
    try {
      // S1: 消息调度
      const s1Stage = this.stages.get('S1-MessageDispatcher') as PipelineStage<LarkMessageEvent, MessagePackage>;
      const messagePackage = await this.executeStageWithFallback(
        s1Stage,
        event
      );
      
      // S2: 上下文组装
      const s2Stage = this.stages.get('S2-ContextAssembler') as PipelineStage<MessagePackage, ContextBundle>;
      const contextBundle = await this.executeStageWithFallback(
        s2Stage,
        messagePackage
      );
      
      // S3+S4: 认知生成
      const s3s4Stage = this.stages.get('S3S4-CognitiveGenerator') as PipelineStage<ContextBundle, CognitiveOutput>;
      const cognitiveOutput = await this.executeStageWithFallback(
        s3s4Stage,
        contextBundle,
        true  // LLM阶段，可能超时
      );

      // 如果不回复，直接跳到S6
      if (!cognitiveOutput.should_reply) {
        this.logger.info('Pipeline: 决定不回复', {
          execution_id: this.context.executionId
        });

        return {
          messages: [],
          total_delay_ms: 0
        };
      }

      // S4.5: 生物传记事实提取器 (v4.2新增)
      // 异步执行，不阻塞Pipeline，后台处理事实提取
      const s45Stage = this.stages.get('S4.5-BiographicalFactExtractor') as PipelineStage<CognitiveOutput, void>;
      if (s45Stage) {
        // 异步执行，不等待结果
        this.executeStageWithFallback(s45Stage, cognitiveOutput).catch(error => {
          this.logger.warn('Pipeline: S4.5异步执行失败', {
            error: (error as Error).message
          });
        });
      }

      // S5: 感知包装
      const s5Stage = this.stages.get('S5-PerceptionWrapper') as PipelineStage<CognitiveOutput, StyledMessages>;
      const styledMessages = await this.executeStageWithFallback(
        s5Stage,
        cognitiveOutput
      );

      // S5.5: Anti-AI验证器
      const s55Stage = this.stages.get('S5.5-AntiAiValidator') as PipelineStage<StyledMessages, ValidatedMessages>;
      const validatedMessages = await this.executeStageWithFallback(
        s55Stage,
        styledMessages
      );

      // S6: 出站调度
      const s6Stage = this.stages.get('S6-OutboundScheduler') as PipelineStage<ValidatedMessages, ScheduledDelivery>;
      const scheduledDelivery = await this.executeStageWithFallback(
        s6Stage,
        validatedMessages
      );
      
      const duration = Date.now() - startTime;
      
      this.logger.info('Pipeline: 执行完成', {
        execution_id: this.context.executionId,
        duration_ms: duration,
        message_count: scheduledDelivery.messages.length
      });
      
      this.context.eventBus.emit('pipeline.complete', {
        executionId: this.context.executionId,
        duration_ms: duration,
        message_count: scheduledDelivery.messages.length
      });
      
      return scheduledDelivery;
      
    } catch (error) {
      this.logger.error('Pipeline: 执行失败', error as Error, {
        execution_id: this.context.executionId
      });
      
      // 超级降级：返回安全的默认回复
      return {
        messages: [{
          content: '你说了什么，我听不太清，再说一遍？',
          send_at: Date.now() + 500,
          typing_indicator_at: Date.now() + 100
        }],
        total_delay_ms: 500
      };
    }
  }
  
  /**
   * 执行一个Stage，支持降级和重试
   */
  private async executeStageWithFallback(
    stage: PipelineStage<any, any>,
    input: any,
    isLLMStage: boolean = false
  ): Promise<any> {
    const timeout = isLLMStage ? 5000 : 1000;  // LLM阶段5秒超时，规则阶段1秒超时
    
    try {
      return await Promise.race([
        stage.process(input, this.context),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Stage timeout')), timeout)
        )
      ]);
    } catch (error) {
      this.logger.warn(`Pipeline: ${stage.name} 执行失败，尝试降级`, {
        error: (error as Error).message
      });
      
      if (stage.degrade) {
        try {
          return await stage.degrade(input, this.context, error as Error);
        } catch (degradeError) {
          this.logger.error(`Pipeline: ${stage.name} 降级失败`, degradeError as Error);
          throw degradeError;
        }
      }
      
      throw error;
    }
  }
}
```

---

## 4. 时间引擎

**文件**: `src/time-engine/time-engine.ts`

#### 4.1 状态概率采样

```typescript
/**
 * 时间引擎
 * 综合天-月-小时-分钟-秒多个维度的时间因子
 */
class TimeEngine {
  /**
   * 最后采样的时间戳
   */
  private lastSampleTime: number = 0;
  
  /**
   * 采样间隔 (小时)
   */
  private samplingIntervalHours: number = 1;
  
  /**
   * 当前缓存的状态
   */
  private cachedState: TimeEngineState;
  
  /**
   * 情绪衰减系数
   * emotion_intensity(t) = initial_intensity × e^(-λt)
   */
  private readonly EMOTION_DECAY_LAMBDA = 0.001;  // λ值
  
  /**
   * 小时级状态的概率分布
   * key: 小时范围, value: 各状态的概率分布
   */
  private readonly HOURLY_DISTRIBUTIONS: Record<string, Record<string, number>> = {
    '0-3': {
      'sleepy': 0.7,
      'calm': 0.2,
      'active': 0.1
    },
    '3-6': {
      'sleepy': 0.9,
      'calm': 0.05,
      'active': 0.05
    },
    '6-9': {
      'active': 0.6,
      'focused': 0.3,
      'sleepy': 0.1
    },
    '9-12': {
      'focused': 0.5,
      'active': 0.4,
      'calm': 0.1
    },
    '12-15': {
      'calm': 0.5,
      'focused': 0.3,
      'sleepy': 0.2
    },
    '15-18': {
      'active': 0.6,
      'focused': 0.3,
      'calm': 0.1
    },
    '18-21': {
      'active': 0.5,
      'calm': 0.4,
      'sleepy': 0.1
    },
    '21-24': {
      'calm': 0.6,
      'sleepy': 0.3,
      'active': 0.1
    }
  };
  
  constructor() {
    this.cachedState = this.initializeState();
  }
  
  /**
   * 初始化时间引擎状态
   */
  private initializeState(): TimeEngineState {
    const now = Date.now();
    const date = new Date(now);
    
    return {
      hour_of_day: date.getHours(),
      day_of_month: date.getDate(),
      season: this.getSeason(date.getMonth()),
      hourly_state: 'active',
      emotion_intensity: 0,
      emotion_direction: 'neutral',
      last_emotion_trigger_at: now,
      emergency_interrupt: false
    };
  }
  
  /**
   * 获取当前时间引擎状态
   * 执行采样、衰减等计算
   */
  getState(): TimeEngineState {
    const now = Date.now();
    const timeSinceLastSample = (now - this.lastSampleTime) / 1000 / 60 / 60;  // 转换为小时
    
    // 是否应该重新采样
    if (timeSinceLastSample > this.samplingIntervalHours) {
      this.sampleHourlyState();
      this.lastSampleTime = now;
    }
    
    // 计算情绪衰减
    const timeSinceEmotionTrigger = (now - this.cachedState.last_emotion_trigger_at) / 1000;  // 秒
    this.cachedState.emotion_intensity = Math.max(
      0,
      this.cachedState.emotion_intensity * Math.exp(-this.EMOTION_DECAY_LAMBDA * timeSinceEmotionTrigger)
    );
    
    // 更新基础时间信息
    const date = new Date(now);
    this.cachedState.hour_of_day = date.getHours();
    this.cachedState.day_of_month = date.getDate();
    this.cachedState.season = this.getSeason(date.getMonth());
    
    // 计算仲裁延迟
    (this.cachedState as any).arbitrated_delay_ms = this.arbitrateDelay();
    
    return this.cachedState;
  }
  
  /**
   * 采样小时级状态
   */
  private sampleHourlyState(): void {
    const hour = new Date().getHours();
    const hourRange = this.getHourRange(hour);
    const distribution = this.HOURLY_DISTRIBUTIONS[hourRange];
    
    if (!distribution) {
      this.cachedState.hourly_state = 'active';
      return;
    }
    
    const random = Math.random();
    let accumulated = 0;
    
    for (const [state, probability] of Object.entries(distribution)) {
      accumulated += probability;
      if (random < accumulated) {
        this.cachedState.hourly_state = state as any;
        return;
      }
    }
  }
  
  /**
   * 触发情绪事件
   * 这会增加emotion_intensity和改变emotion_direction
   */
  triggerEmotion(intensity: number, direction: 'positive' | 'neutral' | 'negative'): void {
    const now = Date.now();
    
    // 叠加新的情绪强度
    this.cachedState.emotion_intensity = Math.min(
      1.0,
      this.cachedState.emotion_intensity + intensity * 0.3  // 新强度的权重降低
    );
    
    this.cachedState.emotion_direction = direction;
    this.cachedState.last_emotion_trigger_at = now;
  }
  
  /**
   * 触发紧急中断
   */
  triggerEmergencyInterrupt(): void {
    this.cachedState.emergency_interrupt = true;
    this.cachedState.emotion_intensity = 1.0;
    this.cachedState.emotion_direction = 'negative';
    this.cachedState.last_emotion_trigger_at = Date.now();
  }
  
  /**
   * 仲裁最终的响应延迟
   * 综合考虑所有时间维度
   */
  private arbitrateDelay(): number {
    // 基础延迟：500-2000ms
    let delay = 500;
    
    // 天-月级调整 (简化版本)
    // 在某些特殊日期可能更快或更慢
    const dayOfMonth = this.cachedState.day_of_month;
    if ([1, 15].includes(dayOfMonth)) {
      delay += 300;  // 特殊日期延迟更长
    }
    
    // 小时级调整
    // 夜间延迟更长，表示"睡意朦胧"
    if (this.cachedState.hourly_state === 'sleepy') {
      delay += 500;
    } else if (this.cachedState.hourly_state === 'focused') {
      delay -= 200;
    }
    
    // 分钟级情绪调整
    // emotion_intensity高时延迟更短，表示"着急"
    delay -= this.cachedState.emotion_intensity * 300;
    
    // 秒级中断调整
    // 紧急中断时立即响应
    if (this.cachedState.emergency_interrupt) {
      delay = 100;
    }
    
    return Math.max(100, delay);
  }
  
  /**
   * 获取小时范围
   */
  private getHourRange(hour: number): string {
    const start = Math.floor(hour / 3) * 3;
    const end = start + 3;
    return `${start}-${end}`;
  }
  
  /**
   * 获取季节
   */
  private getSeason(month: number): 'spring' | 'summer' | 'autumn' | 'winter' {
    if (month >= 2 && month <= 4) return 'spring';
    if (month >= 5 && month <= 7) return 'summer';
    if (month >= 8 && month <= 10) return 'autumn';
    return 'winter';
  }
}

/**
 * 时间引擎状态接口
 * 已在上文定义
 */
```

---

## 5. 事件总线

**文件**: `src/event-bus/event-bus.ts`

```typescript
/**
 * 事件有效负载类型定义
 */
interface EventPayloads {
  'pipeline.stage_complete': {
    executionId: string;
    stageName?: string;
    [key: string]: any;
  };
  
  'pipeline.s1_complete': {
    executionId: string;
    classification: string;
    message_count: number;
  };
  
  'pipeline.s2_complete': {
    executionId: string;
    immediate_memory_length: number;
  };
  
  'pipeline.s3s4_complete': {
    executionId: string;
    should_reply: boolean;
    strategy: string;
  };
  
  'pipeline.s5_complete': {
    executionId: string;
    message_count: number;
  };

  'anti_ai.rule_triggered': {
    executionId: string;
    rule_name: string;
    original_text: string;
    rewritten_text: string;
  };

  'anti_ai.score_calculated': {
    executionId: string;
    ai_score: number;
    dimensions: {
      sentence_regularity: number;
      lexical_diversity: number;
      length_regularity: number;
      connector_frequency: number;
      empathy_template_score: number;
      knowledge_dump_index: number;
      completeness_score: number;
      emotional_authenticity: number;
    };
  };

  'anti_ai.block_triggered': {
    executionId: string;
    ai_score: number;
    triggered_rules: string[];
  };

  'pipeline.s6_complete': {
    executionId: string;
    message_count: number;
    total_delay_ms: number;
  };
  
  'pipeline.complete': {
    executionId: string;
    duration_ms: number;
    message_count: number;
  };
  
  'conversation.emotional': {
    executionId: string;
    emotion: string;
    intensity: number;
  };
  
  'conversation.topic': {
    executionId: string;
    new_topic: string;
    previous_topic?: string;
  };
  
  'conversation.turn_complete': {
    executionId: string;
    user_message: string;
    ai_reply: string;
  };
  
  'time.phase_shift': {
    from_state: string;
    to_state: string;
  };
  
  'identity.challenge': {
    executionId: string;
    pattern: string;
  };
  
  'proactive.trigger': {
    executionId: string;
    trigger_type: string;
  };

  'biography.fact_extracted': {
    executionId: string;
    fact_content: string;
    period: string;
    importance: number;
  };

  'biography.conflict_detected': {
    executionId: string;
    existing_fact_id: string;
    new_fact_id: string;
    conflict_type: 'temporal' | 'logical' | 'contradictory';
    severity: 'low' | 'medium' | 'high';
  };

  'biography.capacity_warning': {
    executionId: string;
    user_id: string;
    fact_count: number;
    capacity_threshold: number;
  };

  'maintenance.biography_cleanup': {
    user_id: string;
    facts_deleted: number;
    timestamp: number;
  };
}

/**
 * 事件总线
 * 用于Stage间的通信和事件发出
 */
class EventBus {
  private listeners: Map<string, Set<Function>> = new Map();
  
  /**
   * 订阅事件
   */
  on<K extends keyof EventPayloads>(
    event: K,
    handler: (payload: EventPayloads[K]) => void
  ): () => void {
    if (!this.listeners.has(event as string)) {
      this.listeners.set(event as string, new Set());
    }
    
    this.listeners.get(event as string)!.add(handler);
    
    // 返回取消订阅函数
    return () => {
      this.listeners.get(event as string)!.delete(handler);
    };
  }
  
  /**
   * 发出事件
   */
  emit<K extends keyof EventPayloads>(
    event: K,
    payload: EventPayloads[K]
  ): void {
    const handlers = this.listeners.get(event as string);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }
  
  /**
   * 一次性订阅事件
   */
  once<K extends keyof EventPayloads>(
    event: K,
    handler: (payload: EventPayloads[K]) => void
  ): () => void {
    const wrapper = (payload: EventPayloads[K]) => {
      handler(payload);
      unsubscribe();
    };
    
    const unsubscribe = this.on(event, wrapper);
    return unsubscribe;
  }
  
  /**
   * 清除所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }
}
```

---

## 6. 降级策略

### 6.1 降级路径

```
正常路径：    S1 → S2 → S3+S4(merged) → S5 → S6  (1 LLM调用)
分离路径：    S1 → S2 → S3+S4(split) → S5 → S6   (2 LLM调用)
无回复路径：  S1 → S2 → S3(规则预检) → END       (0-1 LLM调用)
降级路径：    S1 → S2 → [S3 timeout] → S5(模板) → S6 (0 LLM调用)
```

### 6.2 降级模板

```typescript
/**
 * 降级回复模板
 * 当LLM调用失败或超时时使用
 */
const DEGRADATION_TEMPLATES: Record<string, Record<string, string[]>> = {
  /**
   * 按情绪类型的模板
   */
  'emotional_negative': [
    '我听你说，我都在呢。',
    '有什么想说的吗？我都愿意听。',
    '别太难过，有我在。',
    '告诉我发生了什么吧。',
    '你不是一个人，我在。'
  ],
  
  'emotional_positive': [
    '听起来很开心，我也替你高兴。',
    '太好了！',
    '真棒，能和你分享这个真的很开心。',
    '哈哈，我能感受到你的快乐。',
    '这真的是个好消息！'
  ],
  
  /**
   * 按消息分类的模板
   */
  'direct_question': [
    '嗯，这是个好问题。',
    '让我想想...',
    '这取决于很多因素，你能详细说说吗？',
    '我有点想不清楚，你多说几句？',
    '这个问题比较复杂，再给我点时间思考。'
  ],
  
  'append_type': [
    '我听到了。',
    '继续说，我都听着呢。',
    '嗯，还有呢？',
    '好的，我记下了。',
    '没错，我也这么想。'
  ],
  
  'new_topic': [
    '说说你的想法吧。',
    '我很想听你说。',
    '这听起来有意思。',
    '嗯，跟我说说？',
    '你在想什么呢？'
  ],
  
  /**
   * 按关系阶段的模板
   */
  'stranger': [
    '很高兴认识你。',
    '能和你聊天很开心。',
    '你好，很高兴和你说话。',
    '我叫..., 你呢？',
    '很棒能遇到你。'
  ],

  'acquaintance': [
    '嗯，继续。',
    '你怎么了？',
    '想聊聊吗？',
    '我在听呢。',
    '有什么新鲜事吗？'
  ],
  
  'familiar': [
    '又是你啊，想我吗？',
    '好久不见！',
    '最近怎么样？',
    '又来烦我了吗？哈哈',
    '我就知道你要说这个。'
  ],
  
  'intimate': [
    '傻瓜，说什么呢。',
    '我永远在这儿。',
    '又在想什么鬼主意呢？',
    '你这样可真像你。',
    '别担心，有我呢。'
  ]
};

/**
 * 选择降级模板
 */
function selectDegradationTemplate(
  emotionLevel: string,
  classification: string,
  relationshipStage: string
): string {
  // 优先级：情绪 > 分类 > 关系阶段
  
  let templateKey = emotionLevel;
  let templates = DEGRADATION_TEMPLATES[templateKey];
  
  if (!templates) {
    templateKey = classification;
    templates = DEGRADATION_TEMPLATES[templateKey];
  }
  
  if (!templates) {
    templateKey = relationshipStage;
    templates = DEGRADATION_TEMPLATES[templateKey];
  }
  
  if (!templates) {
    templates = DEGRADATION_TEMPLATES['new_topic'];
  }
  
  return templates[Math.floor(Math.random() * templates.length)];
}
```

---

## 7. 完整的Pipeline初始化示例

```typescript
/**
 * 初始化完整的Pipeline
 */
async function initializePipeline(
  openaiApiKey: string,
  database: Database,
  persona: ResolvedPersona,
  timeEngine: TimeEngine,
  eventBus: EventBus,
  logger: Logger
): Promise<PipelineRunner> {

  const runner = new PipelineRunner(
    {
      persona,
      timeEngine: timeEngine.getState(),
      eventBus,
      logger,
      executionId: '',  // 会在执行时设置
      userId: '',       // 会在执行时设置
      conversationId: '' // 会在执行时设置
    },
    logger
  );

  // 注册所有Stage
  runner.registerStage(new MessageDispatcher());
  runner.registerStage(new ContextAssembler(database));
  runner.registerStage(new CognitiveGenerator(openaiApiKey));
  runner.registerStage(new PerceptionWrapper(persona.perception_config));
  runner.registerStage(new OutboundScheduler());
  
  return runner;
}

/**
 * 执行Pipeline处理消息
 */
async function processMessage(
  runner: PipelineRunner,
  event: LarkMessageEvent,
  context: {
    executionId: string;
    userId: string;
    conversationId: string;
  }
): Promise<ScheduledDelivery> {
  return await runner.run(event);
}
```

---

## 8. 监控和日志

### 8.1 结构化日志格式

所有日志应包含以下字段：

```json
{
  "timestamp": "2026-04-04T12:00:00Z",
  "level": "info|warn|error|debug",
  "executionId": "exec-12345",
  "stage": "S3S4-CognitiveGenerator",
  "message": "描述信息",
  "metadata": {
    "duration_ms": 1500,
    "message_count": 2,
    "error": "错误详情"
  }
}
```

### 8.2 关键指标

- **Pipeline总耗时**: 从S1开始到S6结束的总时间
- **LLM调用次数**: 每个执行周期的API调用数
- **降级触发**: 记录每次降级的原因
- **错误率**: 统计失败和超时的比例

---

## 8.3 v5 新增事件总线事件（生物传记 + Anti-AI + 维护）

```typescript
// === 生物传记事件（4个） ===
eventBus.emit('biography.facts_extracted', {
  facts: BiographicalFact[],
  period: string,
  user_visible_count: number,
  hidden_count: number,
});

eventBus.emit('biography.conflict_detected', {
  executionId: string,
  existing_fact_id: string,
  new_fact_id: string,
  conflict_type: 'time_mismatch' | 'detail_contradiction',
  severity: 'low' | 'medium' | 'high',
});

eventBus.emit('biography.fact_updated', {
  fact_id: string,
  update_type: 'user_visible_flag' | 'deactivation',
  timestamp: number,
});

eventBus.emit('biography.blur_triggered', {
  fact_id: string,
  triggered_triggers: string[],
  blur_applied: boolean,
});

// === Anti-AI 事件（3个） ===
eventBus.emit('anti_ai.rules_applied', {
  applied_rules: string[],  // ['R01', 'R04', 'R06']
  original_length: number,
  modified_length: number,
  truncation_info?: TruncationInfo,
});

eventBus.emit('anti_ai.identity_check_triggered', {
  identity_check_type: 'identity_boundary' | 'ai_detection',
  response_strategy: 'honest' | 'deflect' | 'deny',
  timestamp: number,
});

eventBus.emit('anti_ai.double_blur_prevented', {
  fact_id: string,
  reason: string,  // "blur_already_applied"
  timestamp: number,
});

// === 维护事件（可扩展） ===
eventBus.emit('maintenance.cache_hit', {
  cache_type: string,
  key: string,
  age_ms: number,
});

eventBus.emit('maintenance.performance_anomaly', {
  stage: string,
  duration_ms: number,
  threshold_ms: number,
  severity: 'warning' | 'error',
});
```

---

## 9. 测试覆盖

核心Stage的单元测试应覆盖：

1. **S1**: 消息分类的准确性
2. **S2**: 上下文组装的完整性
3. **S3+S4**: LLM输出的格式和一致性验证
4. **S5**: 人性化效果的正确应用
5. **S6**: 调度时间的准确性

集成测试应模拟完整的Pipeline执行，包括降级场景。

---

**文档完成**

本规范包含了完整的Pipeline架构设计、各Stage的详细实现规范、时间引擎、事件总线和降级策略。所有TypeScript接口都已定义，可直接用于开发。
