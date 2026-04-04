import type { PersonaConfig } from '../config/schemas.js';
import type { TimeState } from '../engine/time-engine.js';
import type { UserProfile } from '../memory/working-memory.js';
import type { Message } from '../memory/immediate-memory.js';

export interface PipelineContext {
  // S1: Raw input
  rawMessageId: string;
  rawChatId: string;
  rawSenderId: string;
  rawSenderName: string;
  rawText: string;
  rawTimestamp: number;
  mentionedBot: boolean;

  // S2: Enriched context
  config: PersonaConfig;
  userProfile: UserProfile | null;
  history: Array<{ role: string; content: string; senderName: string }>;
  timeState: TimeState;
  resolvedSenderName: string;

  // S3+S4: Generated response
  generatedResponse: string;
  selectedModel: string;
  shouldReply: boolean;
  skipReason?: string;

  // S5: Post-processed
  finalResponse: string;
  identityViolation?: string;

  // S6: Delivery result
  deliveryMessageId?: string;
  deliveryStatus: 'pending' | 'sent' | 'failed';
}

export interface PipelineStage {
  name: string;
  execute(ctx: PipelineContext): Promise<PipelineContext>;
}
