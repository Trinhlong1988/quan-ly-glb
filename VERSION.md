---
project: Quản Lý GLB (IMS)
phase: G1
current_version: 0.2.0-phaseB
status: BUILDING (Engineering, chưa Production Validated)
last_update_ts: 2026-07-09
last_update_by: CMD_BUILD (Claude)
rule_break_count: 0
schema_version: 2
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

### 0.2.0-phaseB — 2026-07-09 (CMD_BUILD)
- **Role CRUD + permission assign** (§8): role-service + RolesPage. R_ROLE_005/006/007/009/010 enforced.
- **User CRUD + soft-delete + manager scope** (§9/§11/§12): user-service + StaffPage (lọc theo vai trò/trạng thái + tìm kiếm). R004/R005/R006 + R_MANAGER_001..006 enforced.
- **Permission guard** `guard.ts`: check bằng CODE, thiếu quyền → FORBIDDEN + audit PERMISSION_DENIED (R_AUDIT_003).
- **Audit UI** đọc-only (§16) + before/after diff (R_AUDIT_002). **Backup/Restore** zip+manifest+checksum (dependency-free zip.ts) + FutureSyncService interface (§17).
- **Settings** + SETTING_UPDATED audit. UI KiotViet 5 trang + confirm/password modal (nút Hủy luôn có) + toast.
- **Schema v2**: users.joinDate ("Ngày vào làm" §9) + migration `20260709120000_add_user_join_date`. Prisma client regenerate.
- Bằng chứng: Vitest **61/61 PASS** · typecheck node+web sạch · `build -w @glb/desktop` exit 0 (no warning) · `GLB_SELFTEST=2` integration **24/24 PASS** exit 0 · ZIP verified qua PowerShell Expand-Archive.
- **CHƯA**: restore swap-on-restart · prod DB provisioning · `.exe` (Phase C). Status L1 Engineering PASS (R196).

### 0.1.0-phaseA — 2026-07-09 (đang chạy)
- packages/shared + business-rules (CMD_BUILD): Vitest **41/41 PASS** (verify bởi CMD_AUDIT).
- packages/database (Prisma 7 + better-sqlite3): 9 bảng migrate + seed **20 perm/9 role/35 rolePerm/adminroot** — verify thật. Commit d064ba5.
- apps/desktop (Electron login slice): CMD_BUILD **XONG slice Phase A** — Login → Force Change Password → Dashboard shell CHẠY THẬT.
  - `electron-vite build` exit 0 · GUI window "Quản Lý GLB" mở thật (2 screenshot `apps/desktop/build/*.png`) · headless self-test login 5/5 · typecheck clean · vitest vẫn 41/41.
  - better-sqlite3 rebuild ABI Electron 130 (LOADS in Electron / FAILS in Node 24 — cần rebuild lại nếu chạy DB CLI dưới Node). Chi tiết + rủi ro: `reports/G1_LOCAL_DESKTOP_ADMIN_HR_REPORT.md`.
- Ghi chú: builder subagent bị API 529 (server quá tải) chết 3 lần; DB layer do CMD_AUDIT tự dựng để không đứng hình — sẽ audit lại độc lập.

## Current versions per artifact
| Artifact | Version | Status |
|----------|---------|--------|
| governance scaffold | 0.0.1 | enforced (docs) |
| packages/shared | 0.1.0 | enforced (17 test PASS) |
| packages/business-rules | 0.1.0 | enforced (24 test PASS) |
| packages/database (Prisma+sqlite) | 0.1.0 | enforced (migrate+seed verify) |
| apps/desktop (Electron) | 0.2.0 | partial — Phase A+B CHẠY THẬT (login+role+user+audit+backup); restore-swap/.exe roadmap Phase C |
| packages/business-rules | 0.2.0 | enforced (role/backup/audit/user rules; 61 test PASS) |
| packages/database (schema v2) | 0.2.0 | enforced (joinDate + migration file) |
| G1 role/user/audit/backup | 0.2.0 | enforced (24 self-test integration PASS) — L1 Engineering, chờ LEAD nghiệm thu |
| .exe packaging | — | roadmap (Phase C) |
