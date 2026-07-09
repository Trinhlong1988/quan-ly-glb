---
project: Quản Lý GLB (IMS)
phase: G1
current_version: 0.0.1-scaffold
status: BUILDING (Engineering, chưa Production Validated)
last_update_ts: 2026-07-09
last_update_by: CMD_AUDIT (Claude)
rule_break_count: 0
schema_version: 1
---

# VERSION — Quản Lý GLB

## Session start protocol
1. Đọc `CLAUDE.md` → `docs/IMS_SPEC_v1_0.md`.
2. Đọc file này, so `last_known_version`; mismatch → re-read artifact đổi.
3. Đọc `BUGS_FIXED.md` trước khi chạm code.
4. Đọc `bible/00_constitution.md`.

## Nhật ký phiên bản
### 0.0.1-scaffold — 2026-07-09
- CMD_AUDIT dựng khung governance: CLAUDE.md, bible/00, docs/IMS_SPEC_v1_0.md (copy), prompts/CMD_BUILD + CMD_AUDIT, .gitignore.
- Chưa có code app. Status: chờ CMD_BUILD implement G1.

## Current versions per artifact
| Artifact | Version | Status |
|----------|---------|--------|
| governance scaffold | 0.0.1 | enforced (docs) |
| apps/desktop (Electron) | — | roadmap (CMD_BUILD) |
| packages/database (Prisma) | — | roadmap |
| G1 features | — | roadmap |
