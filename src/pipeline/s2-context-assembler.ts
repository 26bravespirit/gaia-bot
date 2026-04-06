import type { PipelineContext, PipelineStage } from './types.js';
import type { MemoryManager } from '../memory/memory-manager.js';
import type { TimeEngine, TimeState } from '../engine/time-engine.js';
import type { PersonaConfig } from '../config/schemas.js';
import { logger } from '../utils/logger.js';

export class S2ContextAssembler implements PipelineStage {
  name = 'S2:ContextAssembler';

  constructor(
    private memory: MemoryManager,
    private timeEngine: TimeEngine,
    private getConfig: () => PersonaConfig,
  ) {}

  private biographyKeywordPatterns = [
    /小时候|童年|以前|之前|过去|记得/,
    /爸|妈|家人|家里|家庭/,
    /冲浪|摄影|拍照|相机|胶片/,
    /深圳|香港|港大|心理学/,
    /初中|高中|大学|小学/,
  ];

  private extractLtmKeywords(text: string): string[] {
    // Extract meaningful nouns/phrases for long-term memory search
    // Filter out very short or common words
    const segments = text.replace(/[？?！!，,。.、\s]+/g, ' ').trim().split(' ');
    return segments.filter(s => s.length >= 2).slice(0, 5);
  }

  private detectEmotions(text: string, time: TimeState): string[] {
    const emotions: string[] = [];
    if (/开心|高兴|哈哈|不错|太好了|棒/.test(text)) emotions.push('开心');
    if (/难过|伤心|遗憾|哭|失望/.test(text)) emotions.push('难过');
    if (/生气|烦|恼火|气死/.test(text)) emotions.push('烦躁');
    if (/害怕|担心|焦虑|紧张/.test(text)) emotions.push('焦虑');
    if (time.energyLevel < 0.3) emotions.push('疲惫');
    if (time.isSleepMode) emotions.push('困倦');
    return emotions;
  }

  private extractExperiences(text: string): string[] {
    const exp: string[] = [];
    if (/冲浪|surfing|浪/.test(text)) exp.push('冲浪');
    if (/摄影|拍照|照片|相机|胶片/.test(text)) exp.push('摄影');
    if (/家人|家里|爸|妈|父母/.test(text)) exp.push('家人');
    if (/心理学|psychology|心理/.test(text)) exp.push('心理学');
    if (/考试|作业|论文|学习|上课/.test(text)) exp.push('学业');
    if (/吃|美食|餐厅|火锅|奶茶/.test(text)) exp.push('美食');
    if (/旅行|旅游|出去玩/.test(text)) exp.push('旅行');
    if (/咖啡|coffee|手冲|拿铁|espresso|烘焙|豆子/.test(text)) exp.push('咖啡');
    if (/音乐|歌|乐队|演唱会|playlist/.test(text)) exp.push('音乐');
    if (/电影|电视剧|综艺|Netflix|动漫/.test(text)) exp.push('影视');
    if (/工作|上班|加班|老板|同事|项目/.test(text)) exp.push('工作');
    if (/星座|MBTI|性格|白羊|水瓶/.test(text)) exp.push('星座/性格');
    if (/运动|跑步|健身|游泳|篮球/.test(text)) exp.push('运动');
    if (/猫|狗|宠物|毛孩子/.test(text)) exp.push('宠物');
    return exp;
  }

  private estimateSentiment(text: string): number {
    let delta = 0;
    // Positive signals
    if (/开心|高兴|太好了|恭喜|棒|不错|谢谢|感谢|喜欢|爱/.test(text)) delta += 0.05;
    // Negative signals
    if (/难过|伤心|生气|烦|失望|讨厌|害怕|焦虑|紧张|累/.test(text)) delta -= 0.05;
    return delta;
  }

  private extractKeywords(text: string): string[] {
    const keywords: string[] = [];
    for (const pattern of this.biographyKeywordPatterns) {
      const match = text.match(pattern);
      if (match) keywords.push(match[0]);
    }
    return keywords;
  }

  async execute(ctx: PipelineContext): Promise<PipelineContext> {
    if (!ctx.shouldReply) return ctx;

    const config = this.getConfig();
    ctx.config = config;

    // Load user profile
    ctx.userProfile = this.memory.getUserProfile(ctx.rawSenderId);

    // Resolve sender alias
    ctx.resolvedSenderName = this.memory.resolveAlias(ctx.rawSenderName) || ctx.rawSenderName;

    // Get time state
    ctx.timeState = this.timeEngine.getState();

    // Sleep mode disabled — always respond normally regardless of time
    // if (ctx.timeState.isSleepMode && !ctx.mentionedBot) {
    //   const sleepResp = this.timeEngine.getSleepResponse();
    //   if (sleepResp) {
    //     ctx.generatedResponse = sleepResp;
    //     ctx.finalResponse = sleepResp;
    //     ctx.selectedModel = 'sleep_mode';
    //     return ctx;
    //   }
    // }

    // Load conversation history (exclude current message — it's added separately by prompt-builder)
    const historyWindow = this.timeEngine.getHistoryWindowSize();
    const allHistory = this.memory.getRecentHistory(ctx.rawSenderId, historyWindow);
    // Drop the last entry if it matches the current message (already added to memory before pipeline)
    if (allHistory.length > 0) {
      const last = allHistory[allHistory.length - 1];
      if (last.role === 'user' && last.content === ctx.rawText) {
        allHistory.pop();
      }
    }
    ctx.history = allHistory;

    // v0.2.0: Retrieve biography context (user-visible facts only)
    if (config.biography?.anchors?.length) {
      const keywords = this.extractKeywords(ctx.rawText);
      ctx.biographyContext = this.memory.getBiographyContext(keywords.length > 0 ? keywords : undefined);
    }

    // Phase 1: Retrieve long-term memories for context
    const allLtm: Array<{ type: string; content: string; importance: number }> = [];

    // Always inject active promises (not keyword-dependent)
    const promises = this.memory.longTerm.getActivePromises(ctx.rawSenderId, 5);
    for (const p of promises) {
      allLtm.push({ type: p.type, content: p.content, importance: p.importance });
    }

    // Keyword-based memories (emotional events, factual details, etc.)
    const ltmKeywords = this.extractLtmKeywords(ctx.rawText);
    if (ltmKeywords.length > 0) {
      const memories = this.memory.searchMemories(ctx.rawSenderId, ltmKeywords);
      for (const m of memories) {
        // Deduplicate against already-added promises
        if (!allLtm.some(existing => existing.content === m.content)) {
          allLtm.push({ type: m.type, content: m.content, importance: m.importance });
        }
      }
    }

    if (allLtm.length > 0) {
      ctx.longTermMemories = allLtm;
    }

    // Phase 1: Retrieve relationship state from RelationshipModel
    const relationship = this.memory.getRelationship(ctx.rawSenderId);
    ctx.relationshipState = {
      stage: relationship.stage,
      intimacyScore: relationship.intimacyScore,
      interactionCount: relationship.interactionCount,
      topicsShared: relationship.topicsShared,
    };

    // Sync relationship stage to userProfile for prompt-builder consistency
    if (ctx.userProfile && ctx.userProfile.relationshipStage !== relationship.stage) {
      ctx.userProfile = { ...ctx.userProfile, relationshipStage: relationship.stage };
    }

    // Phase 3: Load and update self state (mood, emotions, energy, experiences)
    const selfState = this.memory.getSelfState();

    // Social battery recharge: recover based on silence duration since last update
    const silenceMs = Date.now() - selfState.updatedAt;
    const silenceHours = silenceMs / (1000 * 60 * 60);
    if (silenceHours >= 1 && selfState.socialBattery < 1.0) {
      // Recover 0.15 per hour of silence, cap at 1.0
      const recharge = Math.min(silenceHours * 0.15, 1.0 - selfState.socialBattery);
      selfState.socialBattery = Math.min(1.0, selfState.socialBattery + recharge);
      // Mood also recovers slightly with rest
      selfState.moodBaseline = Math.min(1.0, selfState.moodBaseline + silenceHours * 0.03);
    }

    // Detect emotions from user message
    const emotions = this.detectEmotions(ctx.rawText, ctx.timeState);
    // Compute energy level string from numeric value
    const energyStr = ctx.timeState.energyLevel > 0.7 ? 'high'
                    : ctx.timeState.energyLevel > 0.4 ? 'normal'
                    : 'low';
    // Extract conversation experiences + write to relationship topics
    const newExperiences = this.extractExperiences(ctx.rawText);
    if (newExperiences.length > 0) {
      for (const topic of newExperiences) {
        this.memory.relationships.addTopic(ctx.rawSenderId, topic);
      }
      logger.info(`S2: topics detected [${newExperiences.join(', ')}] for ${ctx.rawSenderId}`);
    }
    // Sentiment-based mood adjustment
    const sentimentDelta = this.estimateSentiment(ctx.rawText);
    const newMood = Math.max(-1, Math.min(1, selfState.moodBaseline + sentimentDelta));

    const updates: Partial<{ moodBaseline: number; activeEmotions: string[]; energyLevel: string; recentExperiences: string[]; socialBattery: number }> = {
      activeEmotions: emotions,
      energyLevel: energyStr,
      socialBattery: selfState.socialBattery,  // includes recharge if any
    };
    if (sentimentDelta !== 0) updates.moodBaseline = newMood;
    else if (silenceHours >= 1) updates.moodBaseline = selfState.moodBaseline;  // apply rest recovery
    if (newExperiences.length > 0) {
      updates.recentExperiences = [...selfState.recentExperiences, ...newExperiences].slice(-10);
    }
    this.memory.updateSelfState(updates);

    ctx.selfState = { ...selfState, ...updates, updatedAt: Date.now() };

    return ctx;
  }
}
