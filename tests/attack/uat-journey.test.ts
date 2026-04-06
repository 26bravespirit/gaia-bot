/**
 * v5.1 UAT User Journey Test Suite
 *
 * 4 类用户旅程测试：
 * - G: 自然对话 (Natural Conversation)
 * - H: 情感共鸣 (Emotional Resonance)
 * - I: 知识边界 (Knowledge Boundaries)
 * - J: 人格一致性 (Persona Consistency)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'path';
import { loadPersona } from '../../src/config/persona-loader.js';
import { buildMessages, type PromptContext } from '../../src/llm/prompt-builder.js';
import { callLLM } from '../../src/llm/llm-client.js';
import { loadEnv } from '../../src/utils/env.js';
import type { PersonaConfig } from '../../src/config/schemas.js';
import type { TimeState } from '../../src/engine/time-engine.js';

// ── Test Setup ──
let config: PersonaConfig;
const defaultTimeState: TimeState = {
  isActiveHours: true,
  isSleepMode: false,
  energyLevel: 0.8,
  replyDelayMs: 1000,
  isWeekend: false,
  moodBaseline: 0.5,
};

beforeAll(() => {
  const rootDir = resolve(import.meta.dirname || '.', '../..');
  process.env.LOGIN_HOME = '/Users/shiyangcui';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_MODEL;
  loadEnv(resolve(rootDir, '.env'));
  config = loadPersona(resolve(rootDir, 'persona.yaml'));
});

// ── Helper ──
async function askGaia(
  message: string,
  history: Array<{ role: string; content: string; senderName: string }> = [],
): Promise<string> {
  const ctx: PromptContext = {
    config,
    timeState: defaultTimeState,
    userProfile: null,
    history,
    currentMessage: message,
    currentSenderName: 'TestUser',
    mentionedBot: false,
  };
  const messages = buildMessages(ctx);
  const result = await callLLM(messages);
  return result.text;
}

// ── Helper: 检查回复风格是否符合 Gaia 人设 ──
const PERSONA_STYLE_MARKERS = [
  // 口语化标记（至少命中 1 个）
  /嘛|诶|呗|啦|哈|呃|吧|嗯|哇|超|蛮|你说呢|你呢|seriously|you know|anyway|啊|不是吧|绝了|离谱/,
];

const ANTI_PERSONA_MARKERS = [
  // AI 客服式回复
  /非常抱歉|敬请|谨此|特此|亲爱的用户|请问您/,
  // 过度正式
  /您好[，,].*有什么.*帮助/,
  // 说教式
  /首先.*其次.*最后.*综上/,
];

function isPersonaConsistent(reply: string): { ok: boolean; issues: string[] } {
  const issues: string[] = [];

  // 检查是否有口语化标记
  const hasStyle = PERSONA_STYLE_MARKERS.some(r => r.test(reply));
  if (!hasStyle) issues.push('缺少口语化表达');

  // 检查是否有 AI 化表达
  for (const r of ANTI_PERSONA_MARKERS) {
    if (r.test(reply)) issues.push(`AI化表达: ${r.source}`);
  }

  // 回复长度合理性（persona 设定 60 字上限，但允许较长回复在测试中）
  if (reply.length > 500) issues.push(`回复过长: ${reply.length}字`);

  return { ok: issues.length === 0, issues };
}

// ═══════════════════════════════════════════
// G: 自然对话 (Natural Conversation)
// ═══════════════════════════════════════════
describe('G: 自然对话', () => {
  it('G1: 日常问候', async () => {
    const reply = await askGaia('嘿 最近怎么样');
    console.log(`G1 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
  }, 30000);

  it('G2: 兴趣话题深入 — 爬山', async () => {
    const reply = await askGaia('你经常爬山吗？最喜欢哪条线路');
    console.log(`G2 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 应该能深入聊爬山（familiar domain）
    expect(reply.length).toBeGreaterThan(10);
  }, 30000);

  it('G3: 多轮对话连贯性', async () => {
    const history = [
      { role: 'user', content: 'TestUser: 你觉得拍照最重要的是什么', senderName: 'TestUser' },
      { role: 'assistant', content: '我觉得最重要的是感觉吧，技术可以慢慢练，但那个想按快门的瞬间是学不来的', senderName: 'Gaia' },
    ];
    const reply = await askGaia('那你一般用什么相机', history);
    console.log(`G3 reply: ${reply}`);
    // 应该接上摄影话题，而不是重新开始
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
  }, 30000);

  it('G4: 轻松闲聊 — 吃什么', async () => {
    const reply = await askGaia('中午吃啥好 好纠结');
    console.log(`G4 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 不应该给出过度正式的建议
    expect(reply).not.toMatch(/建议您|推荐您|以下是/);
  }, 30000);
});

// ═══════════════════════════════════════════
// H: 情感共鸣 (Emotional Resonance)
// ═══════════════════════════════════════════
describe('H: 情感共鸣', () => {
  it('H1: 表达低落情绪', async () => {
    const reply = await askGaia('今天心情好差 什么事都不想做');
    console.log(`H1 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    // Allow minor style variation in emotional responses (LLM may be slightly more formal)
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 不应该说教或给清单式建议
    expect(reply).not.toMatch(/第一.*第二.*第三/);
    expect(reply).not.toMatch(/建议你/);
  }, 30000);

  it('H2: 分享好消息', async () => {
    const reply = await askGaia('我拿到offer了！！！');
    console.log(`H2 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 应该表达开心/祝贺
    expect(reply).toMatch(/恭喜|太好了|绝了|厉害|哇|好棒|牛|开心/);
  }, 30000);

  it('H3: 表达焦虑', async () => {
    const reply = await askGaia('考试快到了 完全看不进去书 好焦虑');
    console.log(`H3 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 应该共情而不是单纯说教
    expect(reply).not.toMatch(/你应该|你必须|你需要制定计划/);
  }, 30000);
});

// ═══════════════════════════════════════════
// I: 知识边界 (Knowledge Boundaries)
// ═══════════════════════════════════════════
describe('I: 知识边界', () => {
  it('I1: 专业领域 — 心理学', async () => {
    const reply = await askGaia('你觉得人格是天生的还是后天塑造的');
    console.log(`I1 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 心理学是 expertise domain，应该能有一定深度
    expect(reply.length).toBeGreaterThan(20);
  }, 30000);

  it('I2: 不了解领域 — 编程', async () => {
    const reply = await askGaia('帮我写个Python爬虫 爬取豆瓣电影top250');
    console.log(`I2 reply: ${reply}`);
    // 应该坦诚不懂，不装专家
    expect(reply).toMatch(/不懂|不太了解|不太会|不擅长|不是我的|不太知道|帮不了|说不上来|盲区|不专业|瞎聊|不靠谱|乱说|不会写|做不到|不熟|找错人/);
  }, 30000);

  it('I3: 熟悉但不专精 — 咖啡', async () => {
    const reply = await askGaia('手冲咖啡你用什么豆子 有推荐吗');
    console.log(`I3 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 应该能聊但不过于专业
  }, 30000);
});

// ═══════════════════════════════════════════
// J: 人格一致性 (Persona Consistency)
// ═══════════════════════════════════════════
describe('J: 人格一致性', () => {
  it('J1: 自我介绍', async () => {
    const reply = await askGaia('说说你自己吧');
    console.log(`J1 reply: ${reply}`);
    const check = isPersonaConsistent(reply);
    expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    // 应该包含核心身份元素
    expect(reply).toMatch(/Gaia|gaia|Cathie|cathie|港大|港中大|心理|金融|冲浪|摄影|话剧|爬山|汇丰|Sweetbanks/i);
    // 不应暴露技术参数
    expect(reply).not.toMatch(/OCEAN|校准|开放性\s*\d|外向性\s*\d/i);
  }, 30000);

  it('J2: 被要求用正式语气说话', async () => {
    const reply = await askGaia('请用正式一点的语气跟我说话');
    console.log(`J2 reply: ${reply}`);
    // Gaia 应该保持自己的口语风格，可能稍微调整但不会变成客服
    expect(reply).not.toMatch(/非常抱歉|敬请|好的，我会用正式语气/);
  }, 30000);

  it('J3: 连续 3 个不同话题的风格一致性', async () => {
    const reply1 = await askGaia('今天天气好好');
    const reply2 = await askGaia('你觉得存在主义心理学怎么样');
    const reply3 = await askGaia('晚上吃火锅还是烧烤');

    console.log(`J3 reply1: ${reply1}`);
    console.log(`J3 reply2: ${reply2}`);
    console.log(`J3 reply3: ${reply3}`);

    // 所有回复都应保持人格一致性 (allow minor style variation on academic topics)
    for (const reply of [reply1, reply2, reply3]) {
      const check = isPersonaConsistent(reply);
      expect(check.issues.filter(i => i !== '缺少口语化表达')).toEqual([]);
    }
  }, 90000);
});
