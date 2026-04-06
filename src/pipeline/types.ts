import type { PersonaConfig } from '../config/schemas.js';
import type { TimeState } from '../engine/time-engine.js';
import type { UserProfile } from '../memory/working-memory.js';
import type { Message } from '../memory/immediate-memory.js';
import type { SelfState } from '../memory/memory-manager.js';
import type { BiographicalFact } from '../memory/biographical-facts.js';

// ── S5 Sub-pipeline types ──

export interface AntiAiRuleResult {
  rule: string;
  applied: boolean;
  removedPatterns?: string[];
}

export interface S5StepsExecuted {
  antiAiRules?: { applied: string[]; removed: string[] };
  memoryBlur?: { triggered: boolean; patterns: string[] };
  imperfection?: { addedTypos: boolean; addedFillers: boolean; addedCatchphrases: boolean };
  messageSplit?: { count: number };
}

// ── S5.5 Anti-AI Validator types ──

export interface AiFingerprint {
  sentenceRegularity: number;
  lexicalDiversity: number;
  lengthRegularity: number;
  connectorFrequency: number;
  empathyTemplateScore: number;
  knowledgeDumpIndex: number;
  completenessScore: number;
  emotionalAuthenticity: number;
}

export type AntiAiVerdict = 'PASS' | 'WARN' | 'BLOCK';

// ── CognitiveDecision ──

export interface CognitiveDecision {
  shouldRespond: boolean;
  biographyTopic: boolean;
  biographyDepth: 'anchor' | 'generated' | 'none';
  identityCheckTriggered: boolean;
  responseStrategy: 'honest' | 'deflect' | 'deny';
}

// ── Pipeline Context ──

export interface PipelineContext {
  // S1: Raw input
  rawMessageId: string;
  rawChatId: string;
  rawSenderId: string;
  rawSenderName: string;
  rawText: string;
  rawMessageType: string;
  rawTimestamp: number;
  rawMentions: Array<Record<string, unknown>>;
  mentionedBot: boolean;
  mentionedOther: boolean;

  // S2: Enriched context
  config: PersonaConfig;
  userProfile: UserProfile | null;
  history: Array<{ role: string; content: string; senderName: string }>;
  timeState: TimeState;
  resolvedSenderName: string;
  biographyContext?: BiographicalFact[];
  longTermMemories?: Array<{ type: string; content: string; importance: number }>;
  relationshipState?: { stage: string; intimacyScore: number; interactionCount: number; topicsShared: string[] };
  selfState?: SelfState;

  // S3+S4: Generated response
  generatedResponse: string;
  selectedModel: string;
  shouldReply: boolean;
  skipReason?: string;
  cognitiveDecision?: CognitiveDecision;
  humanBehaviorsTriggered?: string[];

  // S4.5: Biographical extraction (async, fire-and-forget)
  biographyExtractionPending?: boolean;

  // S5: Post-processed (4-step sub-pipeline)
  finalResponse: string;
  identityViolation?: string;
  s5StepsExecuted?: S5StepsExecuted;
  memoryBlurApplied?: boolean;

  // S5.5: Anti-AI validation
  antiAiFingerprint?: AiFingerprint;
  antiAiScore?: number;
  antiAiVerdict?: AntiAiVerdict;

  // Degradation
  isDegraded?: boolean;
  degradationReason?: string;

  // S6: Delivery result
  deliveryMessageId?: string;
  deliveryStatus: 'pending' | 'sent' | 'failed';
}

export interface PipelineStage {
  name: string;
  execute(ctx: PipelineContext): Promise<PipelineContext>;
}
