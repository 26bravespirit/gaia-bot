# Gaia-Bot

Persona-driven ontological chatbot for Lark/Feishu. Each bot instance has a unique personality defined in `persona.yaml` with Big Five traits, language style, knowledge domains, and memory systems.

## Tech Stack
- **Runtime**: Node.js 20+ with TypeScript (ES2022)
- **Database**: SQLite via better-sqlite3 (WAL mode)
- **LLM**: OpenAI Responses API (gpt-5.1 primary, gpt-4.1-mini fallback)
- **Messaging**: Lark/Feishu via @larksuite/cli
- **Schema**: Zod validation for all configs
- **Tests**: Vitest (171 tests)

## Architecture
8-stage pipeline processing each message:
```
S1 Dispatcher → S2 Context → S3S4 Cognitive → S4.5 Bio Extract
  → S4.6 Memory Extract → S5 Perception → S5.5 Anti-AI → S6 Delivery
```

## Key Directories
- `src/pipeline/` — 8 pipeline stages
- `src/memory/` — Multi-layer memory (immediate, working, long-term, biographical, relationships)
- `src/engine/` — Time engine, identity guardian, event bus, proactive initiator
- `src/llm/` — LLM client + prompt builder
- `src/lark/` — Channel manager, conflict resolver, message router
- `src/config/` — Zod schemas, YAML config loaders, prompt mappings
- `scripts/` — CLI tools (gaia-ctl, dashboard, inspect-memory)
- `tests/` — 171 tests across attack vectors, pipeline, memory, engine

## Commands
- `pnpm dev` — Development mode with hot reload
- `pnpm build` — Compile TypeScript + copy YAML configs
- `pnpm start` — Run production
- `pnpm test` — Run all 171 tests
- `pnpm typecheck` — Type check without emit
- `node scripts/inspect-memory.cjs all` — Query memory system
- `node scripts/gaia-ctl.cjs status` — Channel status
- `node scripts/gaia-dashboard.cjs` — Web dashboard at localhost:3456

## Configuration
- `persona.yaml` — Persona definition (hot-reloadable)
- `.env` — Environment variables (LARK_HOME, OPENAI_API_KEY, etc.)
- `src/config/constraints.yaml` — Anti-AI rules, relationship hints
- `src/config/prompt_mappings.yaml` — Behavior instruction templates

## Onboarding
New users: Run `/setup` skill or follow SKILL.md for guided initialization.

## Design Docs
Architecture specifications are in the separate [gaia-design](https://github.com/26bravespirit/gaia-design) repository.
