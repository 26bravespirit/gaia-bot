import { resolve } from 'path';
import { loadEnv } from './utils/env.js';
import { logger } from './utils/logger.js';
import { acquirePidLock, releasePidLock } from './utils/pid-lock.js';
import { loadPersona, watchPersona, getPersona } from './config/persona-loader.js';
import { MemoryManager } from './memory/memory-manager.js';
import { TimeEngine } from './engine/time-engine.js';
import { IdentityGuardian } from './engine/identity-guardian.js';
import { eventBus } from './engine/event-bus.js';
import { LarkClient } from './lark/lark-client.js';
import { buildChannelManagerFromEnv } from './lark/channel-manager.js';
import type { LarkMessage } from './lark/lark-client.js';
import { ProactiveInitiator } from './engine/proactive-initiator.js';
import { PipelineRunner } from './pipeline/pipeline-runner.js';
import { S1MessageDispatcher } from './pipeline/s1-message-dispatcher.js';
import { S2ContextAssembler } from './pipeline/s2-context-assembler.js';
import { S3S4CognitiveGenerator } from './pipeline/s3s4-cognitive-generator.js';
import { S45BiographicalExtractor } from './pipeline/s4-5-biographical-extractor.js';
import { S46MemoryExtractor } from './pipeline/s4-6-memory-extractor.js';
import { ExtractionScheduler } from './pipeline/extraction-scheduler.js';
import { S5PerceptionWrapper } from './pipeline/s5-perception-wrapper.js';
import { S55AntiAiValidator } from './pipeline/s5-5-anti-ai-validator.js';
import { S6OutboundScheduler } from './pipeline/s6-outbound-scheduler.js';
import type { Message } from './memory/immediate-memory.js';

// ── Load environment ──
const rootDir = resolve(import.meta.dirname || '.', '..');
loadEnv(resolve(rootDir, '.env'));

// ── Single instance lock — kill old instance if running ──
acquirePidLock();

// ── Load persona config ──
const personaPath = resolve(rootDir, process.env.PERSONA_CONFIG || 'persona.yaml');
let config = loadPersona(personaPath);

// ── Initialize core services ──
const dbPath = resolve(rootDir, process.env.DB_PATH || 'data/persona.db');
const memory = new MemoryManager(config, dbPath);
const timeEngine = new TimeEngine(config);
const guardian = new IdentityGuardian(config);
const lark = new LarkClient();

// ── Watch persona config for hot reload ──
watchPersona(personaPath, (updated) => {
  config = updated;
  timeEngine.updateConfig(updated);
  guardian.updateConfig(updated);
  eventBus.publish('persona_reloaded', { name: updated.meta.name });
});

// ── Build pipeline (v0.2.0: S1→S2→S3S4→S4.5→S5→S5.5→S6) ──
const pipeline = new PipelineRunner();
pipeline.addStage(new S1MessageDispatcher());
pipeline.addStage(new S2ContextAssembler(memory, timeEngine, () => config));
pipeline.addStage(new S3S4CognitiveGenerator(memory));
const extractionScheduler = new ExtractionScheduler(memory);
pipeline.addStage(new S45BiographicalExtractor(memory, extractionScheduler));
pipeline.addStage(new S46MemoryExtractor(memory, extractionScheduler));
pipeline.addStage(new S5PerceptionWrapper(guardian, memory));
pipeline.addStage(new S55AntiAiValidator());
pipeline.addStage(new S6OutboundScheduler(lark, memory));

// ── Persist events to SQLite event_log ──
for (const evtType of ['message_received', 'response_sent', 'error', 'persona_reloaded'] as const) {
  eventBus.subscribe(evtType, (event) => {
    memory.logEvent(event.type, 'system', event.payload);
  });
}

// ── Update self_state after each interaction ──
eventBus.subscribe('response_sent', (event) => {
  const selfState = memory.getSelfState();
  // Decrease social battery slightly per interaction
  const newBattery = Math.max(0.1, selfState.socialBattery - 0.02);
  memory.updateSelfState({ socialBattery: newBattery });
});

// ── Message handler shared across all channels ──
async function handleMessage(msg: LarkMessage, _appId: string): Promise<void> {
  // Dedup
  if (memory.isSeen(msg.messageId)) return;
  memory.markSeen(msg.messageId);

  // Check if this channel is enabled via runtime_config
  const channelEnabled = memory.getRuntimeConfig('channel_feishu_enabled');
  if (channelEnabled === 'false') {
    logger.debug('Channel feishu disabled, skipping message');
    return;
  }

  // Record user message in memory
  const userMsg: Message = {
    id: msg.messageId,
    role: 'user',
    content: msg.text,
    senderName: msg.senderName,
    senderId: msg.senderOpenId,
    timestamp: Date.now(),
    chatId: msg.chatId,
  };
  memory.addMessage(userMsg);
  timeEngine.recordInteraction();

  eventBus.publish('message_received', {
    messageId: msg.messageId,
    chatId: msg.chatId,
    senderId: msg.senderOpenId,
    text: msg.text,
  });

  // Run pipeline
  try {
    const result = await pipeline.run({
      messageId: msg.messageId,
      chatId: msg.chatId,
      senderId: msg.senderOpenId,
      senderName: msg.senderName,
      text: msg.text,
      timestamp: Date.now(),
      mentions: msg.mentions,
    });

    if (result.deliveryStatus === 'sent') {
      logger.info(`replied to [${msg.senderName}]: ${result.finalResponse.slice(0, 50)}...`);
    } else if (result.skipReason) {
      logger.debug(`skipped: ${result.skipReason}`);
    }
  } catch (err) {
    logger.error('Pipeline error', { error: String(err) });
  }
}

// ── Main ──
async function main() {
  logger.info(`persona-bot starting: ${config.meta.name}`);

  // Build channel manager from env config
  const channelManager = buildChannelManagerFromEnv();
  channelManager.onMessage(handleMessage);

  // Start all channels
  await channelManager.startAll();

  // Log channel states
  const snapshot = channelManager.getSnapshot();
  for (const [appId, state] of snapshot) {
    logger.info(`channel ${appId}: status=${state.status}, pid=${state.subscribePid}`);
  }

  // Proactive behavior (Phase 6): check every 10 minutes
  const proactive = new ProactiveInitiator(() => config, memory, timeEngine);
  const proactiveInterval = setInterval(() => {
    const msg = proactive.check();
    if (msg) {
      const channel = channelManager.getDefaultChannel();
      if (channel) {
        channel.sendText(msg.chatId, msg.text);
        memory.addMessage({
          id: `proactive_${Date.now()}`,
          role: 'assistant',
          content: msg.text,
          senderName: config.meta.name,
          senderId: process.env.BOT_OPEN_ID || 'bot',
          timestamp: Date.now(),
          chatId: msg.chatId,
        });
        logger.info(`proactive: sent "${msg.text}" to ${msg.userId}`);
      }
    }
  }, 10 * 60_000);

  // Health heartbeat (every 5 minutes)
  const healthInterval = setInterval(() => {
    const snap = channelManager.getSnapshot();
    const states: string[] = [];
    for (const [id, state] of snap) {
      states.push(`${id}:${state.status}`);
    }
    const selfState = memory.getSelfState();
    const evtCount = memory.eventCount();
    logger.info(
      `health: channels=[${states.join(', ')}] ` +
      `self={mood=${selfState.moodBaseline.toFixed(2)}, energy=${selfState.energyLevel}, battery=${selfState.socialBattery.toFixed(2)}} ` +
      `events=${evtCount}`
    );
  }, 5 * 60_000);

  // Graceful shutdown — clean up everything including child process tree
  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(proactiveInterval);
    clearInterval(healthInterval);
    await extractionScheduler.shutdown();
    await channelManager.shutdown();
    memory.close();
    releasePidLock();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('persona-bot is running');
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
