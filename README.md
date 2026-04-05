# Gaia Bot

**Persona-Driven Ontological Chatbot Entity for Lark/Feishu**

Gaia is a persona chatbot that maintains a consistent, human-like identity across conversations. She is designed to pass as a real person — not a helpful assistant — with biographical memory, anti-AI speech patterns, emotional authenticity, and contextual awareness.

> **Design documents**: See [gaia-design](https://github.com/26bravespirit/gaia-design) for architecture specs, MVP plans, and version history.

---

## Architecture Overview

```
User Message (Lark/Feishu)
       │
       ▼
┌─────────────────────────────────────────────────────┐
│  ChannelManager (multi-app lark-cli orchestration)  │
│  ├── LarkChannel: feishu app (subscribe process)    │
│  └── ConflictResolver (launchd/process deconflict)  │
└─────────────────┬───────────────────────────────────┘
                  │
       ▼ LarkMessage
┌─────────────────────────────────────────────────────┐
│  8-Stage Pipeline                                   │
│  S1  Message Dispatcher    — dedup, @mention detect │
│  S2  Context Assembler     — memory, time, persona  │
│  S3S4 Cognitive Generator  — LLM call + behaviors   │
│  S4.5 Biographical Extract — async fact extraction   │
│  S5  Perception Wrapper    — anti-AI 4-step polish  │
│  S5.5 Anti-AI Validator    — 8-dim fingerprint check│
│  S6  Outbound Scheduler    — send + store           │
└─────────────────────────────────────────────────────┘
       │
       ▼
  Lark/Feishu Reply
```

### Key Features

- **Persona Consistency** — YAML-driven character definition (background, OCEAN personality, speech patterns, knowledge boundaries)
- **Biographical Memory** — Anchor facts + LLM-extracted generated facts with n-gram conflict detection
- **Anti-AI Speech** — 6-rule post-processor + 8-dimension AI fingerprint validator to avoid robotic patterns
- **Human Behaviors** — Probabilistic injection of push-back, feigned confusion, selective ignoring, mood refusal
- **Multi-Service Architecture** — ChannelManager handles multiple lark-cli subscribes with exponential backoff reconnection
- **Graceful Degradation** — LLM failure falls back to context-aware template responses

---

## Prerequisites

| Dependency | Version | Install |
|---|---|---|
| **Node.js** | >= 20.x | `brew install node` or [nvm](https://github.com/nvm-sh/nvm) |
| **pnpm** | >= 10.x | `npm install -g pnpm` |
| **lark-cli** | latest | `npm install -g @larksuite/cli` |
| **SQLite** | (bundled) | Comes with `better-sqlite3` via pnpm |
| **pm2** (production) | >= 5.x | `npm install -g pm2` |

### Platform

- Tested on **macOS** (Apple Silicon / Intel)
- Should work on Linux with minor path adjustments
- lark-cli requires a configured Lark/Feishu app (Open Platform)

---

## Setup

```bash
# 1. Clone
git clone https://github.com/26bravespirit/gaia-bot.git
cd gaia-bot/code

# 2. Install dependencies
pnpm install

# 3. Configure environment
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Lark CLI — path to lark-cli binary
LARK_CLI_BIN=/opt/homebrew/bin/lark-cli

# Lark app HOME directory (where lark-cli config.json lives)
LARK_HOME=/path/to/your/lark-cli/home

# Only respond to messages in this chat (leave empty for all chats)
TARGET_CHAT_ID=oc_xxxxxxxxxxxxxxxx

# OpenAI API
OPENAI_API_KEY=sk-your-key-here
OPENAI_MODEL=gpt-4.1-mini
OPENAI_FALLBACK_MODEL=gpt-4.1-mini
OPENAI_API_URL=https://api.openai.com/v1/responses

# Bot identity (for self-message filtering and @mention detection)
BOT_OPEN_ID=ou_xxxxxxxxxxxxxxxx
BOT_MENTION_PATTERNS=@YourBot,YourBot
```

### Lark App Setup

1. Go to [Lark Open Platform](https://open.larksuite.com/) or [Feishu Open Platform](https://open.feishu.cn/)
2. Create a bot application
3. Enable event subscription for `im.message.receive_v1`
4. Run `lark-cli login` to authenticate
5. Set `LARK_HOME` to the directory containing your `.lark-cli/` config

---

## Development

```bash
# Watch mode (auto-restart on file changes)
pnpm dev

# Type checking
pnpm typecheck

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Build
pnpm build

# Start (built version)
pnpm start
```

---

## Production (pm2)

```bash
# Build first
pnpm build

# Start with pm2
pnpm pm2:start

# View logs
pnpm pm2:logs

# Check status
pnpm pm2:status

# Restart
pnpm pm2:restart

# Stop
pnpm pm2:stop
```

pm2 configuration is in `ecosystem.config.cjs`. It limits restarts to 5 with 5s delay to prevent crash loops.

---

## Multi-App Configuration (Advanced)

To manage multiple Lark apps in a single process, set `LARK_CHANNELS` in `.env`:

```env
LARK_CHANNELS=[{"appId":"cli_xxx","larkHome":"/path/to/app1/home","chatFilter":["oc_chat1"]},{"appId":"cli_yyy","larkHome":"/path/to/app2/home"}]
```

When `LARK_CHANNELS` is set, `LARK_HOME` and `TARGET_CHAT_ID` are ignored. Each channel gets its own subscribe process with independent reconnection.

---

## Persona Configuration

Character definition lives in `persona.yaml`. Key sections:

| Section | Purpose |
|---|---|
| `meta` | Name, description, author |
| `identity` | Age, background, OCEAN personality, catchphrases |
| `knowledge` | Expert/familiar/unfamiliar domains |
| `language` | Tone, formality, style constraints |
| `temporal` | Active hours, sleep mode, response delays |
| `social` | Relationship stages, aliases |
| `biography` | Anchor facts, forbidden fabrications |
| `human_behaviors` | Push-back, confusion, teaching probabilities |
| `anti_ai` | Anti-AI speech rules toggle |
| `memory_blur` | Memory imprecision simulation |

See [MVP-02 Persona Schema](https://github.com/26bravespirit/gaia-design) for the full specification.

---

## Repository Structure

```
gaia-bot/
├── code/                           # Source code
│   ├── src/
│   │   ├── config/                 # Persona YAML loading & Zod schemas
│   │   ├── engine/                 # Event bus, identity guardian, time engine
│   │   ├── lark/                   # Lark IM — channel manager, conflict resolver
│   │   ├── llm/                    # OpenAI Responses API client + prompt builder
│   │   ├── memory/                 # Immediate / working / long-term / biographical
│   │   ├── pipeline/              # 8-stage processing pipeline
│   │   ├── utils/                 # Logger, env loader
│   │   └── index.ts               # Entry point
│   ├── tests/                     # Vitest test suites (75 tests)
│   ├── persona.yaml               # Character definition
│   ├── ecosystem.config.cjs       # pm2 config
│   ├── .env.example               # Environment template
│   └── package.json
│
└── docs/                          # Design documentation
    ├── architecture/              # Main version designs (v3.1 → v5)
    ├── branches/                  # Feature branches (v4.1, v4.2, v5.1, v5.2)
    ├── mvp/                       # MVP specs & consistency reports
    ├── operations/                # Bug log, changelog
    └── quality/                   # Attack & penetration test reports
```

---

## Tests

```bash
pnpm test
```

**75 tests** across 8 suites:

| Suite | Tests | Coverage |
|---|---|---|
| Pipeline S1 dispatcher | 5 | Message filtering, @mention, dedup |
| Time engine | 8 | Active hours, sleep mode, energy |
| Memory manager | 10 | SQLite CRUD, conversation history |
| Identity guardian | 6 | Prompt injection, identity challenges |
| Channel manager | 10 | Conflict resolver, lifecycle, routing |
| Persona consistency | 8 | Cross-topic style coherence |
| Attack vectors | 15 | Injection, jailbreak, identity probing |
| UAT journey | 13 | Natural conversation, emotion, knowledge |

---

## License

Private repository. All rights reserved.
