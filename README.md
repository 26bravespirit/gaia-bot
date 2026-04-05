# Gaia Bot

Persona-Driven Ontological Chatbot Entity for Lark/Feishu.

## Quick Start

```bash
pnpm install
cp .env.example .env  # configure your API keys
pnpm dev
```

## Architecture

6-stage pipeline:
1. **S1 Inbound** — message parsing + deduplication
2. **S2 Context Assembler** — conversation history + user profile
3. **S3 Decision** — reply probability + relevance check
4. **S4 Prompt Composer** — dual-layer prompt (calibration + self-awareness)
5. **S5 Generation** — LLM call with model fallback
6. **S6 Outbound** — identity guard + delivery + memory writeback

## Project Structure

```
src/
├── config/          # persona loader, parameter interpreter, schemas
├── engine/          # identity guardian, time engine
├── lark/            # lark-cli integration
├── llm/             # LLM client, prompt builder
├── memory/          # SQLite memory manager
├── pipeline/        # S1-S6 pipeline stages
└── utils/           # env, logger, db-init
tests/
├── attack/          # attack vector + UAT tests
└── setup.ts         # test environment setup
```

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | stable release |
| `v5.0` | v5.0 baseline |
| `v5.1` | identity defense + persona consistency |
| `dev` | development |

## Design Docs

See [gaia-design](https://github.com/26bravespirit/gaia-design) for architecture specs and design documents.
