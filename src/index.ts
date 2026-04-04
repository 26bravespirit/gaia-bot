import { resolve } from 'path';
import { loadEnv } from './utils/env.js';
import { logger } from './utils/logger.js';
import { loadPersona, watchPersona, getPersona } from './config/persona-loader.js';
import { MemoryManager } from './memory/memory-manager.js';
import { TimeEngine } from './engine/time-engine.js';
import { IdentityGuardian } from './engine/identity-guardian.js';
import { eventBus } from './engine/event-bus.js';
import { LarkClient, extractLarkMessage } from './lark/lark-client.js';
import { PipelineRunner } from './pipeline/pipeline-runner.js';
import { S1MessageDispatcher } from './pipeline/s1-message-dispatcher.js';
import { S2ContextAssembler } from './pipeline/s2-context-assembler.js';
import { S3S4CognitiveGenerator } from './pipeline/s3s4-cognitive-generator.js';
import { S5PerceptionWrapper } from './pipeline/s5-perception-wrapper.js';
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
  eventBus.publish('persona_reloaded', { name: updated.identity.name });
});

// ── Build pipeline ──
const pipeline = new PipelineRunner();
pipeline.addStage(new S1MessageDispatcher());
pipeline.addStage(new S2ContextAssembler(memory, timeEngine, () => config));
pipeline.addStage(new S3S4CognitiveGenerator());
pipeline.addStage(new S5PerceptionWrapper(guardian));
pipeline.addStage(new S6OutboundScheduler(lark, memory));

// ── Target chat filter ──
const targetChatId = process.env.TARGET_CHAT_ID?.trim() || '';

// ── Main event loop ──
async function main() {
  logger.info(`persona-bot starting: ${config.meta.name}`);
  logger.info(`target chat: ${targetChatId || '(all chats)'}`);

  const eventTypes = (process.env.EVENT_TYPES || 'im.message.receive_v1').split(',').map(s => s.trim()).filter(Boolean);
  const proc = lark.subscribe(eventTypes);

  if (!proc.stdout) {
    logger.error('Failed to get stdout from subscribe process');
    process.exit(1);
  }

  // Handle stderr
  proc.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) logger.warn(`lark-cli stderr: ${text}`);
  });

  proc.on('exit', (code) => {
    logger.error(`lark-cli subscribe exited with code ${code}`);
    process.exit(1);
  });

  // Read NDJSON lines from stdout
  let buffer = '';
  proc.stdout.on('data', async (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const msg = extractLarkMessage(payload);
      if (!msg) continue;

      // Chat filter
      if (targetChatId && msg.chatId !== targetChatId) continue;

      // Only text messages from users
      if (msg.messageType && msg.messageType !== 'text') continue;
      if (msg.senderType && msg.senderType !== 'user') continue;

      // Dedup
      if (memory.isSeen(msg.messageId)) continue;
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
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    proc.kill();
    memory.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down...');
    proc.kill();
    memory.close();
    process.exit(0);
  });

  logger.info('persona-bot is running');
}

main().catch((err) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
