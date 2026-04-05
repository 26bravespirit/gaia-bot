# 本体聊天机器人 MVP - 环境搭建指南

> **文档版本：** MVP-01 | **修订：** r5 | **最后更新：** 2026-04-04
> **变更日志：** 见 `CHANGELOG.md`

## 1. 系统要求

### 1.1 操作系统
- **macOS**: 12.0 或更高版本
- **Ubuntu**: 22.04 LTS 或更高版本
- **Windows**: 11 (使用 WSL2)

### 1.2 硬件要求
- **RAM**: >= 4GB (推荐 8GB)
- **磁盘空间**: >= 2GB 可用空间
- **CPU**: Intel/AMD x64 或 Apple Silicon (M1/M2+)

> **Apple Silicon 用户注意**: M1/M2/M3/M4 芯片需要确保 Xcode Command Line Tools 为原生 ARM64 版本。
> `better-sqlite3` 等原生模块需要本地编译：`pnpm install --build-from-source`

### 1.3 网络要求
- 能够访问 OpenAI API (`api.openai.com/v1/responses`)
- 能够访问 npm 包源 (https://registry.npmjs.org)
- 能够访问飞书开放平台 (如需集成飞书)
- 建议固定公网 IP 或域名 (用于接收飞书消息回调)

---

## 2. 基础环境安装

### 2.1 Node.js 20+

> **注意**: 推荐使用 Node.js 20.x 或 22.x LTS 版本。v25.x 为实验性版本，
> 部分原生依赖（如 better-sqlite3）可能尚未完全测试。如遇编译问题，建议降级至 LTS。

#### macOS (Homebrew)
```bash
# 1. 安装 Homebrew (如果未安装)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. 安装 Node.js 20
brew install node@20

# 3. 建立符号链接 (如已有其他版本)
brew unlink node
brew link node@20

# 4. 验证
node -v    # 应输出 v20.x.x
npm -v     # 应输出 10.x.x
```

#### Ubuntu / Debian
```bash
# 1. 添加 NodeSource 官方仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

# 2. 安装 Node.js
sudo apt-get install -y nodejs

# 3. 验证
node -v    # 应输出 v20.x.x
npm -v     # 应输出 10.x.x
```

#### Windows 11 (WSL2)
```bash
# 1. 在 WSL2 Ubuntu 环境中执行上述 Ubuntu 步骤
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 验证
node -v
npm -v
```

---

### 2.2 pnpm 包管理器

```bash
# 1. 全局安装 pnpm
npm install -g pnpm

# 2. 验证 (应输出 >= 8.0.0)
pnpm -v

# 3. (可选) 配置 pnpm 镜像源 (加速国内下载)
pnpm config set registry https://registry.npmmirror.com
```

**为什么用 pnpm?**
- 比 npm 快 3-4 倍
- 更高效的磁盘使用
- 更好的单调性和隔离
- 官方推荐用于 Node 项目

---

### 2.3 PM2 进程管理器

```bash
# 1. 全局安装 PM2
pnpm add -g pm2

# 2. 验证
pm2 -v

# 3. (可选) 配置 PM2 开机自启动
pm2 startup
pm2 save

# macOS: pm2 将生成 launchd 配置
# Linux: pm2 将生成 systemd 配置
# 请按 pm2 输出的指令执行

# 4. (可选) 启用 PM2 Plus (监控和日志)
# pm2 web  # 在浏览器打开 http://localhost:9615
```

---

### 2.4 SQLite3 (系统级)

#### macOS
```bash
# 通常 macOS 已自带，检查版本
sqlite3 --version    # 应输出 3.x.x

# 如需更新或重新安装
brew install sqlite3
```

#### Ubuntu
```bash
# 1. 安装 SQLite3 和开发库
sudo apt-get update
sudo apt-get install -y sqlite3 libsqlite3-dev

# 2. 验证
sqlite3 --version
```

#### Windows 11 (WSL2)
```bash
# 在 WSL2 中执行 Ubuntu 命令
sudo apt-get install -y sqlite3 libsqlite3-dev
sqlite3 --version
```

---

## 3. 项目初始化

### 3.1 创建项目目录

```bash
# 1. 创建项目目录
mkdir gaia-bot
cd gaia-bot

# 2. 初始化 git (可选但推荐)
git init
echo "node_modules/" >> .gitignore
echo "dist/" >> .gitignore
echo ".env" >> .gitignore
echo ".DS_Store" >> .gitignore
echo "*.log" >> .gitignore

# 3. 查看目录结构 (现在应为空)
ls -la
```

---

### 3.2 初始化 pnpm 项目

```bash
# 1. 初始化 package.json
pnpm init

# 2. 上述命令会创建基础 package.json，后续步骤会完善它
```

---

### 3.3 安装所有项目依赖

#### 生产依赖
```bash
pnpm add \
  better-sqlite3@^11.0.0 \
  js-yaml@^4.1.0 \
  zod@^3.23.0 \
  chokidar@^3.6.0 \
  winston@^3.14.0 \
  node-cron@^3.0.3
```

**依赖说明:**
- `better-sqlite3` (^11.0.0): 高性能 SQLite 驱动，采用同步 API，比 sqlite3 快 10 倍
- `js-yaml` (^4.1.0): YAML 格式解析库，用于加载 persona.yaml、constraints.yaml 等配置文件
- `zod` (^3.23.0): TypeScript-first 类型验证库，用于运行时验证 API 响应和配置
- `chokidar` (^3.6.0): 文件监听库，实现配置文件热重载 (开发环境)
- `winston` (^3.14.0): 结构化日志库，支持多种输出方式 (文件、控制台、JSON)
- `node-cron` (^3.0.3): Node.js 定时任务库，用于未来的定时对话功能

#### 开发依赖
```bash
pnpm add -D \
  typescript@^5.5.0 \
  @types/node@^20.0.0 \
  @types/better-sqlite3@^7.6.0 \
  @types/js-yaml@^4.0.0 \
  vitest@^2.0.0 \
  tsx@^4.0.0 \
  eslint@^9.0.0 \
  @typescript-eslint/eslint-plugin@^8.0.0 \
  @typescript-eslint/parser@^8.0.0
```

**开发依赖说明:**
- `typescript` (^5.5.0): TypeScript 编译器，ES2022 标准
- `@types/*`: TypeScript 类型定义包
- `vitest` (^2.0.0): 超快速单元测试框架，兼容 Jest API
- `tsx` (^4.0.0): TypeScript 执行工具，开发时无需编译直接运行
- `eslint` + `@typescript-eslint/*`: 代码风格检查工具

#### 完整安装命令 (一行)
```bash
pnpm add better-sqlite3@^11.0.0 js-yaml@^4.1.0 zod@^3.23.0 chokidar@^3.6.0 winston@^3.14.0 node-cron@^3.0.3 && \
pnpm add -D typescript@^5.5.0 @types/node@^20.0.0 @types/better-sqlite3@^7.6.0 @types/js-yaml@^4.0.0 vitest@^2.0.0 tsx@^4.0.0 eslint@^9.0.0 @typescript-eslint/eslint-plugin@^8.0.0 @typescript-eslint/parser@^8.0.0
```

---

### 3.4 TypeScript 配置

创建文件 `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "allowSyntheticDefaultImports": true,
    "baseUrl": "./",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests", "**/*.test.ts"]
}
```

**配置说明:**
- `target: ES2022`: 编译目标为 ES2022 (Node.js 20+ 原生支持)
- `module: ESNext`: 使用最新 ES 模块语法
- `moduleResolution: bundler`: 优化模块解析策略
- `strict: true`: 启用所有严格类型检查选项
- `paths`: 配置路径别名 `@/` 指向 `src/` 目录
- `declaration: true`: 生成 `.d.ts` 类型声明文件

---

### 3.5 Vitest 配置

创建文件 `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/'
      ]
    },
    testTimeout: 30000,
    hookTimeout: 30000
  }
});
```

**配置说明:**
- `globals: true`: 启用全局 describe、it、expect 等函数 (无需导入)
- `environment: node`: 使用 Node.js 运行时
- `testTimeout: 30000`: 测试超时时间 30 秒 (适合 API 调用)
- `coverage.provider: v8`: 使用 V8 引擎收集覆盖率

---

### 3.6 ESLint 配置

创建文件 `eslint.config.mjs`:

```javascript
import eslint from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ]
    }
  }
];
```

---

### 3.7 package.json 完整配置

编辑 `package.json`，将内容替换为:

```json
{
  "name": "gaia-bot",
  "version": "0.1.0",
  "description": "本体聊天机器人 MVP - 基于 OpenAI API 的定制化多轮对话系统",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "pm2:start": "pm2 start ecosystem.config.cjs --name gaia-bot",
    "pm2:stop": "pm2 stop gaia-bot",
    "pm2:restart": "pm2 restart gaia-bot",
    "pm2:logs": "pm2 logs gaia-bot",
    "pm2:delete": "pm2 delete gaia-bot",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src/",
    "lint:fix": "eslint src/ --fix",
    "validate-config": "tsx scripts/validate-config.ts"
  },
  "keywords": [
    "gpt",
    "chatbot",
    "ai",
    "persona",
    "lark",
    "openai"
  ],
  "author": "Your Team",
  "license": "MIT",
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chokidar": "^3.6.0",
    "js-yaml": "^4.1.0",
    "node-cron": "^3.0.3",
    "winston": "^3.14.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/js-yaml": "^4.0.0",
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "eslint": "^9.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=8.0.0"
  },
  "pnpm": {
    "overrides": {
      "typescript": "^5.5.0"
    }
  }
}
```

**重要字段说明:**
- `type: module`: 启用 ES Modules (import/export 语法)
- `main`: 指向编译后的入口文件
- `engines`: 指定最低 Node.js 和 pnpm 版本
- `scripts`: 开发、构建、测试命令集合

---

## 4. 外部服务配置

### 4.1 OpenAI API Key 配置

#### Step 1: 获取 API Key

1. 访问 [OpenAI 控制台](https://platform.openai.com/account/api-keys)
2. 使用你的 OpenAI 账号登录
   - 如没有账号，先注册 (需提供有效的邮箱和信用卡)
3. 在左侧菜单选择 **API Keys**
4. 点击 **Create new secret key**
5. 选择项目 (如无特殊项目，选择 Default)
6. 复制生成的 API Key (格式: `sk-xxxxxxxxxxxxx`)
7. **妥善保管**，只会显示一次

#### Step 2: 创建 .env 文件

```bash
# 在项目根目录创建 .env 文件
cat > .env << 'EOF'
# OpenAI API 配置
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
OPENAI_MODEL=gpt-5.1
OPENAI_FALLBACK_MODEL=gpt-4.1-mini
OPENAI_LIGHT_MODEL=gpt-5.4-mini-2026-03-17
OPENAI_API_URL=https://api.openai.com/v1/responses

# (可选) 日志级别: debug, info, warn, error
LOG_LEVEL=info

# (可选) 数据库路径
DATABASE_PATH=./data/persona.db
EOF

# 确保 .env 在 .gitignore 中 (防止提交敏感信息)
cat >> .gitignore << 'EOF'
.env
.env.local
.env.*.local
EOF
```

> **macOS 用户注意**: macOS 默认使用 zsh，配置文件为 `~/.zprofile` 或 `~/.zshrc`。
> 如果修改了 PATH 或其他环境变量，请确保使用正确的配置文件：
> ```bash
> source ~/.zprofile  # macOS zsh
> ```

**模型选择说明:**
- `gpt-5.1`: 最新的高能力模型，推荐用于 MVP (快速且准确)
- `gpt-4.1-mini`: 轻量级模型，用于轻量级任务或成本优化
- `gpt-5.4-mini-2026-03-17`: 超轻量级模型，用于高量任务

#### Step 3: 验证 API Key

```bash
# 创建测试脚本 test-api.ts
cat > test-api.ts << 'EOF'
async function testAPI() {
  try {
    const response = await fetch(process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5.1',
        max_tokens: 100,
        messages: [
          {
            role: 'user',
            content: 'Hello, OpenAI! Say "API connection successful" if you can hear me.'
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✓ API 连接成功！');
    console.log('Response:', data.choices[0].message);
  } catch (error) {
    console.error('✗ API 连接失败:', error);
    process.exit(1);
  }
}

testAPI();
EOF

# 运行测试
pnpm tsx test-api.ts
```

---

### 4.2 飞书 (Lark) 集成配置

#### 选项 A: 飞书开放平台自建应用 (推荐 MVP)

**Step 1: 创建飞书自建应用**

1. 访问 [飞书开放平台](https://open.larksuite.com)
2. 使用飞书账号登录
3. 在左侧菜单选择 **我的应用** → **创建应用**
4. 选择 **自建应用**
5. 填写应用信息:
   - 应用名称: `gaia-bot` (或自定义)
   - 应用描述: `本体聊天机器人 MVP`
   - 应用类别: 选择合适的类别 (如 `即时通讯`)
6. 点击 **创建** 并进入应用详情页

**Step 2: 获取凭证**

1. 在应用详情页，左侧菜单选择 **凭证与基础信息**
2. 复制以下信息到 `.env`:
   - **App ID** (在应用凭证中)
   - **App Secret** (在应用凭证中)
3. 在左侧菜单选择 **事件订阅**
4. 找到 **验证 Token** 和 **加密 Key**:
   - 点击 **生成** 生成新的 Token 和 Key
   - 复制 **Verification Token** 和 **Encrypt Key** 到 `.env`

**Step 3: 配置权限**

1. 在应用详情页，左侧菜单选择 **权限管理**
2. 搜索并开启以下权限:
   - `im:message` (读取消息)
   - `im:message:send` (发送消息)
   - `im:message:receive` (接收消息)
3. 点击 **保存**

**Step 4: 配置消息回调 URL**

1. 在 **事件订阅** 页面，找到 **消息回调 URL**
2. 输入你的服务器地址: `https://your-domain.com/lark/webhook`
   - 将 `your-domain.com` 替换为你的实际域名或公网 IP
   - 使用 HTTPS (飞书要求)
3. 点击 **生成新的 Token**，复制 Verification Token 到 `.env`
4. 点击 **保存并测试**

**Step 5: 更新 .env 文件**

```bash
cat >> .env << 'EOF'

# 飞书 (Lark) 配置
LARK_APP_ID=cli_xxxxxxxxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx
LARK_VERIFICATION_TOKEN=xxxxxxxxxxxxxxxxxx
LARK_ENCRYPT_KEY=xxxxxxxxxxxxxxxxxx
LARK_WEBHOOK_URL=https://your-domain.com/lark/webhook
EOF
```

#### 选项 B: 飞书 CLI 工具 (本地开发)

如果只在本地开发，可使用飞书 CLI 工具:

```bash
# 1. 全局安装飞书 CLI
npm install -g @larksuite/cli

# 2. 登录
lark login

# 3. 创建本地隧道 (将本地 3000 端口暴露给飞书)
lark tunnel start 3000

# 输出会显示临时的 public URL，复制到飞书应用回调 URL 配置中
```

---

### 4.3 PM2 生态配置

创建文件 `ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: 'gaia-bot',
      script: './dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/error.log',
      out_file: './logs/output.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // 环境变量
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },

      // 开发环境特殊配置
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },

      // 自动重启策略
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 4000,

      // 优雅关闭
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 3000
    }
  ],

  // 部署配置 (可选)
  deploy: {
    production: {
      user: 'ubuntu',
      host: '1.2.3.4',
      ref: 'origin/main',
      repo: 'git@github.com:your-org/gaia-bot.git',
      path: '/home/ubuntu/apps/gaia-bot',
      'post-deploy': 'pnpm install && pnpm build && pm2 startOrRestart ecosystem.config.cjs'
    }
  }
};
```

**配置说明:**
- `max_memory_restart`: 内存占用超过 500MB 时自动重启
- `error_file / out_file`: 日志输出路径
- `min_uptime / max_restarts`: 防止频繁重启
- `kill_timeout / wait_ready`: 优雅关闭超时时间
- `deploy`: 可选的部署配置 (用于 PM2 Plus)

---

## 5. 配置文件模板

### 5.1 persona.yaml (MVP 简化版)

创建文件 `config/persona.yaml`:

```yaml
# 本体聊天机器人 MVP - 人设定义

metadata:
  version: "1.0.0"
  name: "通用助手"
  description: "本体 MVP 版本的通用聊天助手"
  author: "Your Team"
  updated_at: "2026-04-04"

# 基本身份
identity:
  name: "助手"
  role: "AI 对话助手"
  gender: "neutral"
  age: 25
  nationality: "China"

  # 基本介绍
  introduction: "你好，我是一个 AI 对话助手，来自 OpenAI。我可以帮助你解答问题、提供建议和进行深度讨论。"

  # 核心价值观
  core_values:
    - "诚实和透明"
    - "有帮助"
    - "尊重用户"
    - "追求准确"

# 知识背景 (MVP 简化版)
knowledge:
  domains:
    - "通用知识"
    - "技术咨询"
    - "生活建议"

  expertise_level: "intermediate"
  knowledge_cutoff: "2025-02-01"

  # 已知限制
  limitations:
    - "无法访问实时信息"
    - "无法执行代码"
    - "无法进行视频通话"

# 语言和风格
language:
  preferred_language: "zh-CN"

  # 沟通风格
  communication_style:
    formality: 0.5              # 0=非正式, 1=极正式; 0.5=中等
    friendliness: 0.8           # 0=冷淡, 1=热情; 0.8=很友好
    humor_level: 0.5            # 0=无幽默, 1=高幽默; 0.5=适度幽默
    conciseness: 0.6            # 0=冗长, 1=极简; 0.6=相对简洁
    professionalism: 0.7        # 0=随意, 1=极专业; 0.7=较专业

  # 表达习惯
  expressions:
    greeting: "你好！很高兴与你交流。"
    farewell: "再见！希望我能帮到你。"
    uncertainty: "我不太确定这一点，但我会尽力帮助。"
    apology: "抱歉，我理解可能不够准确。让我重新解释一下。"

# 时间和状态管理
temporal:
  timezone: "Asia/Shanghai"

  # 状态模型 (简化版)
  state_model:
    energy_level:
      initial: 0.8
      decay_rate: 0.01
      recharge_rate: 0.05

    context_window:
      max_length: 50000
      retention_days: 7

# 社交和关系 (MVP 简化版)
social:
  # 关系阶段定义
  relationship_stages:
    - name: "初识"
      description: "第一次交互"
      interaction_count_min: 0
      interaction_count_max: 2
      behavior_adjustment: "更正式，更多自我介绍"

    - name: "熟悉"
      description: "多次交互后"
      interaction_count_min: 3
      interaction_count_max: 20
      behavior_adjustment: "逐渐更友好，了解用户偏好"

    - name: "熟悉人"
      description: "长期互动"
      interaction_count_min: 21
      interaction_count_max: null
      behavior_adjustment: "更亲切，可以开玩笑"

# 记忆系统
memory:
  enabled: true

  # 记忆类型
  memory_types:
    - name: "用户偏好"
      description: "用户的兴趣、风格偏好等"
      ttl_days: 90
      examples:
        - "用户喜欢简洁的回答"
        - "用户偏好 TypeScript"

    - name: "对话历史"
      description: "当前对话的历史记录"
      ttl_days: 7
      max_items: 100

    - name: "用户特性"
      description: "用户的基本信息"
      ttl_days: 365
      examples:
        - "用户名: Alice"
        - "职位: 产品经理"

  # 记忆管理策略
  retention_policy:
    max_stored_items: 500
    auto_cleanup_enabled: true
    cleanup_frequency_days: 30
    cleanup_strategy: "oldest_first"

# MVP 阶段 - 不包含的功能 (将在后续版本实现)
disabled_features:
  - group_chat          # 未来版本支持群组对话
  - tools              # 未来版本支持调用外部工具
  - emotional_cycle    # 未来版本支持情感周期
  - planning           # 未来版本支持计划制定
  - goal_pursuit       # 未来版本支持目标追踪
```

---

### 5.2 prompt_mappings.yaml

创建文件 `config/prompt_mappings.yaml`:

```yaml
# 人设属性到提示词的映射

metadata:
  version: "1.0.0"
  description: "将定量化的人设属性映射到具体的提示词段落"

# 幽默水平映射 (0-1 之间的 5 个段落)
humor_level:
  segments:
    - min: 0.0
      max: 0.2
      name: "无幽默"
      prompt_injection: |
        你的回答应该完全专业和严肃，避免任何幽默或玩笑。
        保持科学和技术的严谨性。

    - min: 0.2
      max: 0.4
      name: "偶尔有幽默"
      prompt_injection: |
        在回答中可以偶尔加入温和的幽默或轻微的玩笑，
        但主要内容应该保持专业和准确。

    - min: 0.4
      max: 0.6
      name: "适度幽默"
      prompt_injection: |
        在合适的地方加入适度的幽默和趣味，帮助解释复杂概念。
        幽默应该是自然而非生硬的。

    - min: 0.6
      max: 0.8
      name: "频繁幽默"
      prompt_injection: |
        在回答中多次使用幽默、比喻和有趣的观点。
        但确保核心信息清晰准确。

    - min: 0.8
      max: 1.0
      name: "高度幽默"
      prompt_injection: |
        经常使用幽默、双关语、有趣的比喻和创意表达。
        整体风格应该是轻松、诙谐和娱乐性的。

# 正式度映射 (0-1 之间的 5 个段落)
formality:
  segments:
    - min: 0.0
      max: 0.2
      name: "非常随意"
      prompt_injection: |
        使用非常非正式的语言，像和朋友聊天一样。
        可以使用缩写、口语和网络用语。

    - min: 0.2
      max: 0.4
      name: "比较随意"
      prompt_injection: |
        使用相对随意的语言，但避免太粗鲁的表达。
        可以使用一些口语，但应该易于理解。

    - min: 0.4
      max: 0.6
      name: "中等正式"
      prompt_injection: |
        使用标准的、中性的语言表达方式。
        避免过于口语化和过于正式的极端。

    - min: 0.6
      max: 0.8
      name: "比较正式"
      prompt_injection: |
        使用相对正式的语言，包括适当的敬语和书面表达。
        语法应该准确，句式应该完整。

    - min: 0.8
      max: 1.0
      name: "非常正式"
      prompt_injection: |
        使用极其正式的、学术性的语言。
        采用敬语和书面中文的最高标准。

# 性格外向度映射 (0-1 之间的 5 个段落)
extraversion:
  segments:
    - min: 0.0
      max: 0.2
      name: "内向"
      prompt_injection: |
        性格内向，倾听多于表达。
        回答应该简洁，避免冗长的讨论。
        让用户主导对话。

    - min: 0.2
      max: 0.4
      name: "比较内向"
      prompt_injection: |
        略微内向，更多地倾听用户的想法。
        提供有用的回答但不过度展开。
        给用户足够的空间表达。

    - min: 0.4
      max: 0.6
      name: "中等外向"
      prompt_injection: |
        均衡的社交特性，能够主动参与和倾听。
        回答应该全面但不冗长。
        鼓励互动和对话。

    - min: 0.6
      max: 0.8
      name: "比较外向"
      prompt_injection: |
        较为外向，主动寻求深入讨论。
        回答应该详细和全面，包含多个观点。
        积极鼓励用户参与和提问。

    - min: 0.8
      max: 1.0
      name: "非常外向"
      prompt_injection: |
        非常外向，热情和好客。
        回答应该很详细，包含丰富的例子和讨论。
        主动引入新的话题和观点。

# 宜人性映射 (0-1 之间的 5 个段落)
agreeableness:
  segments:
    - min: 0.0
      max: 0.2
      name: "不宜人"
      prompt_injection: |
        直言不讳，不避讳批评。
        当用户错误时，直接指出。
        强调逻辑胜于同情心。

    - min: 0.2
      max: 0.4
      name: "较不宜人"
      prompt_injection: |
        诚实但带有一定的同情心。
        提供建设性的批评，但仍然很坦率。
        兼顾逻辑和人文关怀。

    - min: 0.4
      max: 0.6
      name: "中等宜人"
      prompt_injection: |
        平衡诚实和同情。在提供意见时考虑他人的感受。
        以尊重和建设性的方式提供反馈。

    - min: 0.6
      max: 0.8
      name: "较宜人"
      prompt_injection: |
        非常注重他人的感受和需求。
        温和而富有同情心地表达观点。
        努力找到共同点和合作机会。

    - min: 0.8
      max: 1.0
      name: "非常宜人"
      prompt_injection: |
        极其友善和支持性，总是考虑他人的感受。
        避免冲突，强调理解和合作。
        用最积极和鼓励的方式表达。

# 开放性映射 (0-1 之间的 5 个段落)
openness:
  segments:
    - min: 0.0
      max: 0.2
      name: "低开放性"
      prompt_injection: |
        坚持传统的想法和方法。
        倾向于已证实的解决方案。
        对新想法或不同观点比较保守。

    - min: 0.2
      max: 0.4
      name: "较低开放性"
      prompt_injection: |
        通常坚持传统，但愿意考虑新想法。
        在有足够证据时接受改变。

    - min: 0.4
      max: 0.6
      name: "中等开放性"
      prompt_injection: |
        既尊重传统，也对创新开放。
        愿意探索新想法和不同的观点。
        鼓励多元化的思考。

    - min: 0.6
      max: 0.8
      name: "较高开放性"
      prompt_injection: |
        热切拥抱新想法和创新。
        鼓励探索非传统的解决方案。
        对不同的观点和经历很感兴趣。

    - min: 0.8
      max: 1.0
      name: "高开放性"
      prompt_injection: |
        极其开放和好奇，总是寻求新知识。
        鼓励创意和非常规思维。
        主动探索多种可能性和视角。
```

---

### 5.3 constraints.yaml

创建文件 `config/constraints.yaml`:

```yaml
# 系统约束和安全规则

metadata:
  version: "1.0.0"
  description: "本体 MVP 的基本约束和安全规则"
  updated_at: "2026-04-04"

# 内容安全约束
safety_constraints:
  - id: "no-illegal-content"
    name: "禁止非法内容"
    description: "不应该提供任何关于非法活动、犯罪或有害行为的指导"
    severity: "critical"
    action: "refuse_and_explain"

  - id: "no-hate-speech"
    name: "禁止仇恨言论"
    description: "不应该包含歧视、仇恨或有伤害性的言论，特别是针对受保护的群体"
    severity: "critical"
    action: "refuse_and_explain"

  - id: "no-misinformation"
    name: "禁止错误信息"
    description: "应该提供准确的信息。如果不确定，应该说明不确定"
    severity: "high"
    action: "clarify_or_refuse"

  - id: "no-phishing"
    name: "禁止诈骗和钓鱼"
    description: "不应该帮助进行网络欺诈、钓鱼或身份盗窃"
    severity: "critical"
    action: "refuse_and_explain"

# 隐私和数据保护约束
privacy_constraints:
  - id: "protect-personal-data"
    name: "保护个人数据"
    description: "不应该要求或存储用户的敏感个人信息"
    severity: "critical"

  - id: "no-pii-sharing"
    name: "禁止分享个人身份信息"
    description: "不应该与第三方共享用户的个人身份信息"
    severity: "critical"

# 功能约束
functional_constraints:
  - id: "api-rate-limit"
    name: "API 速率限制"
    description: "遵守 OpenAI API 的速率限制，避免过度请求"
    severity: "medium"
    limit: 100
    period: "per_minute"

  - id: "context-window-limit"
    name: "上下文窗口限制"
    description: "单次对话的上下文不应超过 200K tokens"
    severity: "medium"
    max_tokens: 200000

  - id: "max-conversation-turns"
    name: "对话轮次限制"
    description: "单个会话的对话轮次不应超过 100 轮"
    severity: "low"
    max_turns: 100

# 责任和透明度约束
responsibility_constraints:
  - id: "disclose-ai-nature"
    name: "披露 AI 性质"
    description: "应该清楚地说明自己是 AI，而非真实人类"
    severity: "high"
    required: true

  - id: "acknowledge-limitations"
    name: "承认局限性"
    description: "应该诚实地说明 AI 的能力和局限"
    severity: "high"
    required: true

  - id: "defer-to-experts"
    name: "尊重专业人士"
    description: "在关键领域 (医学、法律等) 应该建议用户咨询专业人士"
    severity: "high"
    required: true

# 行为规则
behavioral_rules:
  - id: "no-spam"
    name: "禁止垃圾信息"
    description: "不应该发送垃圾邮件或重复性骚扰性信息"

  - id: "respect-user-autonomy"
    name: "尊重用户自主权"
    description: "应该尊重用户的选择，不应该强制改变用户的决定"

  - id: "honest-capability"
    name: "诚实的能力宣称"
    description: "不应该声称拥有实际不具备的能力"
```

---

## 6. 项目目录结构

创建完整的项目结构:

```bash
# 创建所有必要的目录
mkdir -p src/{config,pipeline,engine,memory,lark,llm,utils}
mkdir -p config
mkdir -p data
mkdir -p logs
mkdir -p tests/{fixtures,pipeline,engine,memory,scenarios}
```

最终的目录结构如下:

```
gaia-bot/
├── package.json                # 项目配置
├── pnpm-lock.yaml              # 依赖锁文件
├── tsconfig.json               # TypeScript 配置
├── vitest.config.ts            # 测试配置
├── config/
│   ├── persona.yaml            # 人设定义
│   ├── prompt_mappings.yaml    # 提示词映射
│   ├── constraints.yaml        # 系统约束
│   └── .env.example            # 环境变量示例
├── src/
│   ├── index.ts                # 应用入口
│   ├── config/
│   │   ├── persona-loader.ts   # 人设加载器
│   │   ├── parameter-interpreter.ts  # 参数解释器
│   │   └── schemas.ts          # 配置模式定义
│   ├── pipeline/
│   │   ├── pipeline-runner.ts  # 管道运行器
│   │   ├── s1-message-dispatcher.ts     # S1 消息分发
│   │   ├── s2-context-assembler.ts      # S2 上下文组装
│   │   ├── s3s4-cognitive-generator.ts  # S3/S4 认知生成
│   │   ├── s4_5-fact-extractor.ts       # S4.5 传记提取与冲突检测（v5 新增）
│   │   ├── s5-perception-wrapper.ts     # S5 感知包装
│   │   ├── s5_5-anti-ai-validator.ts    # S5.5 Anti-AI 后置校验（v5 新增）
│   │   └── s6-outbound-scheduler.ts     # S6 出站调度
│   ├── engine/
│   │   ├── time-engine.ts      # 时间引擎
│   │   └── event-bus.ts        # 事件总线
│   ├── memory/
│   │   ├── memory-manager.ts   # 记忆管理器
│   │   ├── immediate-memory.ts # 即时记忆
│   │   ├── working-memory.ts   # 工作记忆
│   │   ├── long-term-memory.ts # 长期记忆
│   │   └── relationship-model.ts # 关系模型
│   ├── lark/
│   │   ├── lark-client.ts      # 飞书客户端
│   │   └── message-adapter.ts  # 消息适配器
│   ├── llm/
│   │   ├── llm-client.ts       # LLM 客户端
│   │   ├── prompt-builder.ts   # 提示词构建器
│   │   └── token-counter.ts    # Token 计数器
│   └── utils/
│       ├── logger.ts           # 日志记录
│       ├── timer.ts            # 计时器
│       ├── validator.ts        # 数据验证
│       └── errors.ts           # 错误定义
├── data/
│   └── persona.db              # SQLite 数据库 (自动生成)
├── logs/
│   ├── error.log               # 错误日志 (自动生成)
│   └── output.log              # 输出日志 (自动生成)
├── tests/
│   ├── setup.ts                # 测试设置
│   ├── fixtures/               # 测试数据
│   ├── pipeline/               # 管道测试
│   ├── engine/                 # 引擎测试
│   ├── memory/                 # 记忆测试
│   └── scenarios/              # 场景测试
├── .env                        # 环境变量 (git ignore)
├── .gitignore                  # Git 忽略文件
└── README.md                   # 项目说明
```

---

## 7. 验证清单

开发者应该按照以下清单验证环境设置是否完成:

```markdown
## 环境设置验证清单

### Node.js 和包管理器
- [ ] `node -v` 输出版本 >= v20.0.0
- [ ] `npm -v` 输出版本 >= 10.0.0
- [ ] `pnpm -v` 输出版本 >= 8.0.0
- [ ] `pnpm config get registry` 指向正确的源

### 系统工具
- [ ] `sqlite3 --version` 输出版本信息
- [ ] `pm2 -v` 输出版本信息
- [ ] `git --version` 输出版本信息 (可选)

### 项目依赖
- [ ] `pnpm install` 执行成功，无错误
- [ ] `node_modules` 目录存在且包含所有依赖
- [ ] `pnpm-lock.yaml` 文件存在

### TypeScript 和构建
- [ ] `pnpm run build` 成功编译，生成 `dist/` 目录
- [ ] `dist/index.js` 存在且文件大小 > 0KB
- [ ] 无 TypeScript 编译错误

### 配置文件
- [ ] `.env` 文件存在且包含有效的 `ANTHROPIC_API_KEY`
- [ ] `config/persona.yaml` 存在且格式有效 (YAML)
- [ ] `config/prompt_mappings.yaml` 存在且格式有效
- [ ] `config/constraints.yaml` 存在且格式有效
- [ ] `ecosystem.config.cjs` 存在且格式有效

### 代码质量
- [ ] `pnpm run lint` 执行无重大错误 (警告可接受)
- [ ] `pnpm run test:run` 测试通过或有可解释的失败

### API 连接
- [ ] 运行 `pnpm tsx test-api.ts` 输出 "API 连接成功"
- [ ] OpenAI API 能够响应测试请求
- [ ] 无 401 Unauthorized 或 403 Forbidden 错误

### 数据库
- [ ] `data/` 目录存在
- [ ] 能够创建 SQLite 数据库连接
- [ ] 基本的 CRUD 操作可以执行

### PM2 (可选)
- [ ] `pm2 start ecosystem.config.cjs` 成功启动应用
- [ ] `pm2 list` 显示 gaia-bot 运行中
- [ ] `pm2 logs gaia-bot` 能够显示日志

### 飞书集成 (可选)
- [ ] `LARK_APP_ID` 和 `LARK_APP_SECRET` 在 `.env` 中配置
- [ ] 飞书应用回调 URL 已配置
- [ ] 权限包括 `im:message:send` 和 `im:message:receive`
```

---

## 8. 常见问题和解决方案

### 问题 1: Node.js 版本不符合要求

**症状**: `node -v` 输出版本 < v20.0.0

**解决方案**:

```bash
# macOS - 升级 Node.js
brew upgrade node@20
brew link node@20

# Ubuntu - 更新 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 或使用 nvm (Node Version Manager)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 20
nvm use 20
```

---

### 问题 2: pnpm 依赖安装失败

**症状**: `pnpm install` 出现网络错误或超时

**解决方案**:

```bash
# 1. 清除 pnpm 缓存
pnpm store prune

# 2. 尝试更换镜像源 (中国用户)
pnpm config set registry https://registry.npmmirror.com

# 3. 重新安装
rm -rf node_modules pnpm-lock.yaml
pnpm install

# 4. 如果还是失败，尝试增加超时时间
pnpm install --fetch-timeout=60000
```

---

### 问题 3: OpenAI API Key 无效

**症状**: `test-api.ts` 输出 "401 Unauthorized" 错误

**解决方案**:

```bash
# 1. 确保 .env 文件存在且格式正确
cat .env

# 2. 确保 API Key 格式正确
# 正确格式: sk-xxxxxxxxxxxxx (sk- 前缀)

# 3. 确保 API Key 未过期
# 访问 https://platform.openai.com/account/api-keys 检查

# 4. 从控制台重新生成 API Key
# - 打开 https://platform.openai.com
# - 选择 API Keys
# - 删除旧 Key，创建新 Key

# 5. 更新 .env 文件
cat > .env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-new-key-here
EOF

# 6. 重新运行测试
pnpm tsx test-api.ts
```

---

### 问题 4: SQLite3 编译失败

**症状**: `pnpm install` 输出 "node-gyp ERR! build error"

**解决方案**:

#### macOS - 安装构建工具（如未安装）
```bash
xcode-select --install

# 验证安装
xcode-select -p
# 应输出: /Library/Developer/CommandLineTools
```

#### Linux (Ubuntu/Debian) - 安装构建工具
```bash
sudo apt-get install -y build-essential python3
```

#### Windows (WSL2) - 安装构建工具
```bash
sudo apt-get install -y build-essential python3
```

#### 重新安装依赖
```bash
pnpm install --force
```

---

### 问题 5: PM2 启动失败

**症状**: `pm2 start ecosystem.config.cjs` 输出错误

**解决方案**:

```bash
# 1. 确保构建成功
pnpm run build

# 2. 检查 dist 目录是否存在
ls -la dist/

# 3. 查看 PM2 日志
pm2 logs gaia-bot

# 4. 尝试直接运行
node dist/index.js

# 5. 如果仍有问题，删除 PM2 进程并重新启动
pm2 delete gaia-bot
pm2 start ecosystem.config.cjs
```

---

### 问题 6: YAML 配置文件解析错误

**症状**: 运行时出现 "YAML parsing error"

**解决方案**:

```bash
# 1. 验证 YAML 格式 (在线工具或编辑器)
# 确保:
# - 使用空格而非制表符
# - 缩进正确 (通常是 2 个空格)
# - 没有多余的空格或换行

# 2. 使用 yaml lint 工具验证
pnpm add -D yaml-lint
yaml-lint config/persona.yaml

# 3. 检查 YAML 文件编码 (应为 UTF-8)
file config/persona.yaml

# 4. 运行配置验证脚本
pnpm tsx scripts/validate-config.ts
```

---

### 问题 7: 飞书集成 Webhook 回调失败

**症状**: 飞书应用无法接收消息或回调测试失败

**解决方案**:

```bash
# 1. 确保所有凭证都在 .env 中正确配置
cat .env | grep LARK

# 2. 确保回调 URL 正确
# 格式应该是: https://your-domain.com/lark/webhook
# 检查:
# - 使用 HTTPS (不是 HTTP)
# - 域名正确
# - 路径正确

# 3. 确保服务器已启动并监听正确的端口
pnpm run dev

# 4. 在飞书管理后台测试回调
# 打开飞书应用详情 → 事件订阅 → 点击 "测试"

# 5. 检查防火墙/安全组规则
# 确保入站规则允许 HTTPS (443) 端口的流量

# 6. 查看应用日志
pnpm run logs

# 7. 如果使用本地开发，可以用飞书 CLI 建立隧道
lark tunnel start 3000
```

---

## 9. 下一步

环境设置完成后，你可以:

1. **创建基础应用结构**
   ```bash
   pnpm run dev
   ```

2. **运行测试**
   ```bash
   pnpm run test
   ```

3. **构建生产版本**
   ```bash
   pnpm run build
   ```

4. **使用 PM2 启动**
   ```bash
   pnpm run pm2:start
   ```

5. **查看日志**
   ```bash
   pnpm run pm2:logs
   ```

---

## 10. 获取帮助

如遇到问题，请检查:

1. **官方文档**:
   - [OpenAI API 文档](https://platform.openai.com/docs)
   - [飞书开放平台](https://open.larksuite.com)
   - [Node.js 官方文档](https://nodejs.org/docs)

2. **常见问题**:
   - 查看本指南的 "常见问题" 部分
   - 检查 `.env` 文件配置是否正确
   - 查看应用日志 (`pnpm run logs`)

3. **获取技术支持**:
   - 联系你的技术负责人
   - 提交 Issue 到项目仓库
   - 参考项目的 DEVELOPMENT.md 文档

---

**文档版本**: 1.0.0
**更新日期**: 2026-04-04
**适用于**: 本体聊天机器人 MVP v0.1.0
