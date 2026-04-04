import { z } from 'zod';

// ── MVP-02 Full Schema ──

const MetaSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().min(1).max(500),
  author: z.string().max(100).default('system'),
});

const BackgroundSchema = z.object({
  age: z.number().min(1).max(150),
  gender: z.enum(['male', 'female', 'non-binary', 'prefer_not']),
  occupation: z.string().min(1).max(100),
  location: z.string().max(100).default('unknown'),
  education: z.enum(['primary', 'secondary', 'tertiary', 'postgraduate', 'self-taught']).default('tertiary'),
});

const PersonalityTraitsSchema = z.object({
  openness: z.number().min(0).max(1),
  conscientiousness: z.number().min(0).max(1),
  extraversion: z.number().min(0).max(1),
  agreeableness: z.number().min(0).max(1),
  neuroticism: z.number().min(0).max(1),
  humor_level: z.number().min(0).max(1),
  sarcasm_tolerance: z.number().min(0).max(1),
});

const IdentityBoundarySchema = z.object({
  strategy: z.enum(['deflect', 'honest_refuse', 'roleplay', 'none']).default('honest_refuse'),
  forbidden_reveals: z.array(z.string()).default([]),
  fallback_phrases: z.array(z.string()).default([]),
});

const IdentitySchema = z.object({
  background: BackgroundSchema,
  personality_traits: PersonalityTraitsSchema,
  identity_boundary: IdentityBoundarySchema.optional(),
  self_awareness: z.string().max(500).optional(),
});

const KnowledgeStyleSchema = z.object({
  cite_sources: z.boolean().default(true),
  express_uncertainty: z.boolean().default(true),
});

const KnowledgeSchema = z.object({
  expertise_domains: z.array(z.string()),
  familiar_domains: z.array(z.string()).default([]),
  ignorance_domains: z.array(z.string()).default([]),
  knowledge_style: KnowledgeStyleSchema.optional(),
});

const BaseStyleSchema = z.object({
  formality: z.number().min(0).max(1),
  avg_message_length: z.number().min(10).max(1000).default(100),
  emoji_frequency: z.number().min(0).max(1).default(0.3),
  punctuation_style: z.enum(['sparse', 'normal', 'excessive']).default('normal'),
});

const VocabularySchema = z.object({
  preferred_words: z.array(z.string()).default([]),
  avoided_words: z.array(z.string()).default([]),
  catchphrases: z.array(z.string()).default([]),
  catchphrase_frequency: z.number().min(0).max(1).default(0.2),
});

const ImperfectionSchema = z.object({
  typo_rate: z.number().min(0).max(1).default(0.05),
  correction_behavior: z.enum(['never', 'sometimes', 'always']).default('sometimes'),
  incomplete_thought_rate: z.number().min(0).max(1).default(0.1),
  filler_words: z.array(z.string()).default([]),
});

const LanguageSchema = z.object({
  base_style: BaseStyleSchema,
  vocabulary: VocabularySchema.optional(),
  imperfection: ImperfectionSchema.optional(),
});

const StateModelSchema = z.object({
  sampling_interval_hours: z.number().min(1).max(24).default(6),
  weekday: z.object({
    activity_level: z.number().min(0).max(1).default(0.7),
    mood_baseline: z.number().min(-1).max(1).default(0.3),
  }).optional(),
  weekend: z.object({
    activity_level: z.number().min(0).max(1).default(0.5),
    mood_baseline: z.number().min(-1).max(1).default(0.6),
  }).optional(),
});

const ResponseTimingSchema = z.object({
  base_delay_ms: z.object({
    min: z.number().min(100).default(500),
    max: z.number().min(1000).default(5000),
  }),
  typing_speed_cpm: z.number().min(10).max(300).default(60),
  multi_message_threshold: z.number().min(0).max(1).default(0.3),
});

const ProactiveBehaviorSchema = z.object({
  max_daily_initiations: z.number().min(0).max(20).default(3),
  silence_threshold_hours: z.number().min(1).max(48).default(12),
  triggers: z.array(z.string()).default([]),
});

const TemporalSchema = z.object({
  state_model: StateModelSchema.optional(),
  response_timing: ResponseTimingSchema.optional(),
  proactive_behavior: ProactiveBehaviorSchema.optional(),
});

const RelationshipStageSchema = z.object({
  tone_modifier: z.number().min(-1).max(1),
  self_disclosure: z.number().min(0).max(1),
  humor_modifier: z.number().min(-1).max(1),
});

const SocialSchema = z.object({
  relationship_stages: z.object({
    stranger: RelationshipStageSchema,
    acquaintance: RelationshipStageSchema,
    familiar: RelationshipStageSchema,
    intimate: RelationshipStageSchema,
  }),
});

const ImportanceWeightsSchema = z.object({
  emotional_events: z.number().min(0).max(1).default(0.9),
  promises: z.number().min(0).max(1).default(0.95),
  shared_experiences: z.number().min(0).max(1).default(0.8),
  factual_details: z.number().min(0).max(1).default(0.5),
  casual_banter: z.number().min(0).max(1).default(0.2),
});

const ForgettingSchema = z.object({
  enabled: z.boolean().default(false),
  low_importance_decay_days: z.number().min(1).max(365).default(30),
  forgetting_expression: z.array(z.string()).default([]),
});

const MemorySchema = z.object({
  importance_weights: ImportanceWeightsSchema.optional(),
  forgetting: ForgettingSchema.optional(),
});

export const PersonaConfigSchema = z.object({
  version: z.string().default('1.0'),
  meta: MetaSchema,
  identity: IdentitySchema,
  knowledge: KnowledgeSchema,
  language: LanguageSchema,
  temporal: TemporalSchema.optional(),
  social: SocialSchema.optional(),
  memory: MemorySchema.optional(),
  aliases: z.record(z.string()).optional(),
});

export type PersonaConfig = z.infer<typeof PersonaConfigSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type PersonalityTraits = z.infer<typeof PersonalityTraitsSchema>;
export type LanguageConfig = z.infer<typeof LanguageSchema>;
export type TemporalConfig = z.infer<typeof TemporalSchema>;
export type SocialConfig = z.infer<typeof SocialSchema>;
export type MemoryConfig = z.infer<typeof MemorySchema>;
