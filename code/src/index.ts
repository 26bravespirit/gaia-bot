import { resolve } from 'path';
import { loadEnv } from './utils/env.js';
import { logger } from './utils/logger.js';
import { loadPersona, watchPersona, getPersona } from './config/persona-loader.js';
import { MemoryManager } from './memory/memory-manager.js';
import { TimeEngine } from './engine/time-engine.js';
import { IdentityGuardian } from './engine/identity-guardian.js';
import { eventBus } from './engine/event-bus.js';
import { LarkClient } from './lark/lark-client.js';
import { buildChannelManagerFromEnv } from './lark/channel-manager.js';
import type { LarkMessage } from './lark/lark-client.js';
import { PipelineRunner } from './pipeline/pipeline-runner.js';
import { S1MessageDispatcher } from './pipeline/s1-message-dispatcher.js';
import { S2ContextAssembler } from './pipeline/s2-context-assembler.js';
import { S3S4CognitiveGenerator } from './pipeline/s3s4-cognitive-generator.js';
import { S45BiographicalExtractor } from './pipeline/s4-5-biographical-extractor.js';
import { S5PerceptionWrapper } from './pipeline/s5-perception-wrapper.js';
import { S55AntiAiValidator } from './pipeline/s5-5-anti-ai-validator.js';
import { S6OutboundScheduler } from './pipeline/s6-outbound-scheduler.js';
import type { Message } from './memory/immediate-memory.js';

// ── Load environment ──
const rootDir = resolve(import.meta.dirname || '.', '..');
loadEnv(resolve(rootDir, '.env'));

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
pipeline.addStage(new S3S4CognitiveGenerator());
pipeline.addStage(new S45BiographicalExtractor(memory));
pipeline.addStage(new S5PerceptionWrapper(guardian, memory));
pipeline.addStage(new S55AntiAiValidator());
pipeline.addStage(new S6OutboundScheduler(lark, memory));

// ── Message handler shared across all channels ──
async function handleMessage(msg: LarkMessage, _appId: string): Promise<void> {
  // Dedup
  if (memory.isSeen(msg.messageId)) return;
  memory.markSeen(msg.messageId);

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
  logger.info(`gaia-bot starting: ${config.meta.name}`);

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

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await channelManager.shutdown();
    memory.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('gaia-bot is running');
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
