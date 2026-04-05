# Gaia Bot

Persona-Driven Ontological Chatbot Entity for Lark/Feishu.

## Repository Structure

```
gaia-bot/
├── code/                          # Source code (TypeScript)
│   ├── src/                       # Application source
│   │   ├── config/                # Persona config loading & schemas
│   │   ├── engine/                # Event bus, identity guardian, time engine
│   │   ├── lark/                  # Lark IM integration + multi-channel
│   │   ├── llm/                   # LLM client + prompt builder
│   │   ├── memory/                # Multi-tier memory system
│   │   ├── pipeline/              # 8-stage processing pipeline (S1→S6)
│   │   ├── utils/                 # Logger, env utilities
│   │   └── index.ts               # Entry point
│   ├── tests/                     # Test suites
│   ├── persona.yaml               # Persona definition
│   ├── ecosystem.config.cjs       # pm2 production config
│   └── package.json
│
└── docs/                          # Design documentation
    ├── architecture/              # Main version designs (v3.1→v5)
    ├── branches/                  # Feature branch designs (v4.1, v4.2, v5.1, v5.2)
    ├── mvp/                       # MVP development specs
    ├── operations/                # Bug logs, changelogs
    └── quality/                   # Attack test reports
```

## Setup

```bash
cd code
pnpm install
cp .env.example .env   # Fill in your credentials
pnpm build
pnpm start
```

## Development

```bash
pnpm dev              # tsx watch mode
pnpm test             # vitest
pnpm typecheck        # tsc --noEmit
```

## Production (pm2)

```bash
pnpm pm2:start        # Start with ecosystem.config.cjs
pnpm pm2:logs         # View logs
pnpm pm2:stop         # Stop
```
