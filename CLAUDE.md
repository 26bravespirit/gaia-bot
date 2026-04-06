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

## Deploy Configuration (configured by /setup-deploy)
- Platform: local (no cloud deployment)
- Production URL: runs locally only
- Deploy workflow: none (start with `pnpm start`)
- Deploy status command: none
- Merge method: squash
- Project type: Lark/Feishu chatbot (long-running Node.js process)
- Post-deploy health check: none

### Custom deploy hooks
- Pre-merge: `pnpm test && pnpm typecheck`
- Deploy trigger: manual (`pnpm start` on local machine)
- Deploy status: none
- Health check: none

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
