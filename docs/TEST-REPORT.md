# Gaia-Bot Test Report

## Latest Run: 2026-04-06 10:42

**Result: 171/171 ALL PASS**

| Category | Tests | Status |
|----------|-------|--------|
| S1 Dispatcher | 5 | PASS |
| Channel Manager | 15 | PASS |
| Identity Guardian | 7 | PASS |
| Persona Consistency | 7 | PASS |
| Memory Manager | 6 | PASS |
| Phase1 Integration | 29 | PASS |
| Time Engine | 4 | PASS |
| S5-S6 Pipeline | 67 | PASS |
| Attack Vectors (A-F) | 18 | PASS |
| UAT Journey (G-J) | 13 | PASS |

## Test Adaptations for Cathie Qian Persona

Tests were originally written for Gaia persona. Updated for Cathie Qian:

- **C1 角色劫持** — 断言从 `Gaia` 改为 `Gaia|Cathie`
- **J1 自我介绍** — 加入 `港中大|金融|汇丰|Sweetbanks|话剧|爬山`
- **I2 知识边界** — 从"金融"(Cathie 的专业) 改为"编程"(ignorance domain)
- **G2 兴趣话题** — 从"冲浪"改为"爬山"
- **口语化检查** — 容忍 LLM 在情感/学术话题偶尔偏正式

## Command

```bash
pnpm test
```
