---
project: Quản Lý GLB (IMS)
phase: G-CFG.3
current_version: 0.6.0-gcfg3
status: BUILDING (Engineering, chưa Production Validated)
last_update_ts: 2026-07-09
last_update_by: CMD_BUILD (Claude)
rule_break_count: 0
schema_version: 6
---

# VERSION — Quản Lý GLB

## Session start protocol
1. Đọc `CLAUDE.md` → `docs/IMS_SPEC_v1_0.md`.
2. Đọc file này, so `last_known_version`; mismatch → re-read artifact đổi.
3. Đọc `BUGS_FIXED.md` trước khi chạm code.
4. Đọc `bible/00_constitution.md`.

## Nhật ký phiên bản
### 0.6.0-gcfg3 — 2026-07-09 (CMD_BUILD)
- **G-CFG.3 Cấu hình phí (§C5)**: Loại phí (C5a) + Biểu phí % theo **Đối tác × Loại thẻ** (C5b). LEAD chốt: mỗi loại thẻ (Visa/Master/Napas/UnionPay/Amex…) của 1 đối tác có biểu phí riêng; set lại = cập nhật (upsert).
- **Schema v6**: migration `20260709160000_gcfg3_fee_config` (`fee_types`, `fee_rates`). Phí lưu Int = %×1000 (≤3 thập phân, chính xác tuyệt đối, KHÔNG float). Chênh lệch NCC/KH là cột TÍNH động (không lưu).
- **2 permission** CONFIG_FEE_VIEW/MANAGE (gán ADMIN/MANAGER/ACCOUNTANT). 5 AuditAction mới.
- **Backend** `fee-config-service.ts`: FeeType CRUD (B05 pattern) + `setFeeRate` upsert (reactivate bản xóa mềm) + validate ngân-hàng-của-thẻ phải liên kết đối tác (NOT_LINKED) + validate phí ≤3 thập phân. Xóa mềm + mật khẩu.
- **UI** `FeeConfigPage.tsx` (2 tab) — form set phí Đối tác→Ngân hàng(liên kết)→Loại thẻ + 3 ô phí + preview chênh lệch realtime; cột CL tô màu (âm=đỏ trong ngoặc, dương=xanh) đúng §C5b. Multi-select + Xuất Excel. Menu "Cấu hình phí". AuditPage + Thùng rác mở rộng FeeType/FeeRate.
- Bằng chứng: **Vitest 178/178** · typecheck 0 · build 0 · **GLB_SELFTEST=7 102/102 PASS exit 0** (50 đúng + 52 sai) · regression **=4 109/109 · =5 107/107 · =6 106/106**.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §C mục 8 TK nhận tiền (G-CFG.4) · §9 TID config · §10 Hồ sơ (G-CFG.5). Status L1 Engineering PASS (R196).

### 0.5.1-gcfg2b — 2026-07-09 (CMD_BUILD)
- **§C2/C3/C4b + C6–C8 tích chọn nhiều dòng + Xóa đã chọn** (đóng lỗ hổng "tích chọn 1 hoặc nhiều" của SPEC).
- Primitive tái dùng `components/Selection.tsx` (`useRowSelection` + `SelectionBar` + `SelectAllCell`/`SelectCell`) — áp ĐỒNG BỘ 7 bảng master (ngân hàng/loại thẻ/đối tác + NCC/chủng loại/nhập kho/trạng thái) theo R_UI_STANDARD.
- Thanh "Đã chọn N · Bỏ tích · Xóa đã chọn" (nút đỏ) → ConfirmDialog nhập lại mật khẩu → xóa mềm hàng loạt (backend `*Delete(ids[])` đã có, phủ bởi selftest).
- Bằng chứng: typecheck node+web 0 · `build -w @glb/desktop` exit 0. UI-only, backend không đổi.

### 0.5.0-gcfg2 — 2026-07-09 (CMD_BUILD)
- **G-CFG.2 Cấu hình cung ứng máy POS (§C6–C8)**: NCC (§C6) · Chủng loại máy POS (§C7) · Trạng thái nhập (§C8a) · Nhập kho máy POS (§C8b, có chuyển NCC khi sửa).
- **Schema v5**: migration `20260709150000_gcfg2_pos_supply` (4 bảng `suppliers`/`pos_models`/`pos_intake_statuses`/`pos_intakes`, truy vết created_by/updated_by/deleted_at). Áp SẴN bài học B05 (mọi cột @unique → DUPLICATE_TRASH + lưới P2002).
- **2 permission** CONFIG_POS_SUPPLY_VIEW/MANAGE (group Cấu hình máy POS), gán ADMIN/MANAGER/WAREHOUSE.
- **Backend** `pos-supply-service.ts`: CRUD 4 thực thể + validate khóa tham chiếu (chủng loại/trạng thái/NCC tồn tại & còn sống) + validate giá (số nguyên ≥0) + ngày nhập. Permission-guard + audit before/after 12 action mới (SUPPLIER/POS_MODEL/INTAKE_STATUS/POS_INTAKE_*).
- **UI** `PosSupplyPage.tsx` (4 tab) — design system chuẩn + ngày nhập 3 ô dd/mm/yyyy + tiền VND (nhóm 3 số, không toLocaleString) + STT + Xuất Excel. Wire menu "Cấu hình máy POS" + route. AuditPage + Thùng rác + AuditAction mở rộng cho 4 thực thể mới.
- Bằng chứng: **Vitest 178/178** · typecheck node+web 0 · build 0 · **GLB_SELFTEST=5 107/107 PASS exit 0** (57 đúng + 50 sai, R_LINK_VERIFY) · regression **=4 G-CFG.1 109/109** · **=6 Thùng rác 106/106** (mở rộng 4 thực thể OK). DB throwaway migrate deploy.
- **CHƯA**: nghiệm thu UI thật (LEAD) · §C5 phí (G-CFG.3) · §C multi-select (G-CFG.2b) · TK nhận tiền/TID/Hồ sơ (G-CFG.4/5). Status L1 Engineering PASS (R196).

### 0.4.0-gcfg1 — 2026-07-09 (CMD_BUILD)
- **G-CFG.1 Cấu hình ngân hàng (§C1–C4)**: Ngân hàng · Loại thẻ POS (map `bankId`) · Đối tác · liên kết Đối tác↔Ngân hàng (ma trận tích xanh, many-to-many soft-delete).
- **Schema v4**: migration `20260709140000_gcfg1_bank_config` (4 bảng `banks`/`card_types`/`partners`/`partner_banks`, đều có `created_by/updated_by/deleted_at` — truy vết R_AUDIT_TRAIL). Prisma regenerate.
- **4 permission** CONFIG_BANK_VIEW/MANAGE + TRASH_VIEW/TRASH_RESTORE (group Cấu hình ngân hàng / Thùng rác). ADMIN full.
- **Backend** `bank-config-service.ts`: CRUD Bank/CardType/Partner + `setPartnerBanks`/`getPartnerBankMatrix`/`listBanksLite`. Permission-guard bằng CODE, audit before/after mọi thao tác (BANK/CARD_TYPE/PARTNER/PARTNER_BANK_*), xóa mềm + nhập lại mật khẩu.
- **UI** `BankConfigPage.tsx` (3 tab) — design system chuẩn: Button variant (confirm/edit/danger/neutral), FilterBar, Modal, ConfirmDialog requirePassword, toast.alert lỗi to-rõ, cột truy vết Ngày|Giờ (fmtDate/fmtTime), Xuất Excel (CSV BOM). Wire menu "Cấu hình ngân hàng" + route. AuditPage bổ sung nhãn tiếng Việt cho action G-CFG.
- **BUG G-CFG-B01 (B05) phát hiện+vá**: xóa mềm ngân hàng/đối tác rồi tạo lại cùng mã → P2002 crash. Fix: pre-check trùng mã toàn cục + phân biệt `DUPLICATE_TRASH` + lưới an toàn bắt P2002. Xem BUGS_FIXED.md.
- Bằng chứng: **Vitest 178/178 PASS** · typecheck node+web exit 0 · `build -w @glb/desktop` exit 0 · **GLB_SELFTEST=4 109/109 PASS exit 0** (57 đúng + 52 sai, R_LINK_VERIFY) · **GLB_SELFTEST=6 (Trash regression) 106/0 PASS** (không vỡ). Chạy trên DB throwaway migrate deploy.
- **CHƯA**: nghiệm thu UI tương tác thật (LEAD) · Production Validation. Status L1 Engineering PASS (R196).

### 0.3.0-gpos1 — 2026-07-09 (CMD_BUILD)
- **G-POS.1 phần A (POS/TID event-sourced) + D (mã NV/KH + KH nickname)** theo `docs/POS_TID_CASHFLOW_DESIGN_PROPOSAL.md` (APPROVED). KHÔNG làm phần B thu chi.
- **Schema v3**: migration `20260709130000_gpos1_asset_library` (additive): `users.employee_code` + 7 bảng (`customers`, `agents`, `pos_devices`, `tids`, `asset_events`, `pos_tid_bindings`, `code_counters`). Resolve drift `join_date` + `migrate deploy` sạch. adminroot → NV01.
- **9 permissions mới** (CUSTOMER/POS/TID/ASSET) + `db.ts` seed đổi thành idempotent additive re-sync mỗi boot. ADMIN=29 quyền.
- **business-rules/asset.rules.ts**: state machine POS+TID + code format (13 vitest).
- **Services**: code-service (nextCode atomic), customer-service, pos-service (7 transition + timeline), tid-service (assign/replace/recall/markDelivered + undelivered aging), notification-service (badge REAL, push Zalo STUB).
- **UI**: CustomersPage, PosPage (+Timeline), TidPage (+tab TID chưa giao), StaffPage mã NV, Dashboard 3 menu + badge, `components/FilterBar.tsx` tái dùng (R_UX_FILTER: date range + dims + search + Làm mới, lọc server-side). R_UX_WARN: message tiếng Việt cụ thể mọi lỗi.
- Bằng chứng: **Vitest 74/74 PASS** · desktop typecheck node+web exit 0 · `build -w @glb/desktop` exit 0 · **GLB_SELFTEST=3 40/40 PASS exit 0** · **GLB_SELFTEST=2 (Phase B regression) failures=0** (G1 KHÔNG vỡ) · dev.db verify NV01 + counters.
- **CHƯA**: nghiệm thu UI tương tác thật (LEAD) · push Zalo thật (STUB) · thu chi (phần B) · .exe (Phase C). Status L1 Engineering PASS (R196).

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
| packages/database (schema v3) | 0.3.0 | enforced (migration 20260709130000 deploy thật + 7 bảng) |
| business-rules asset.rules (state machine + code) | 0.3.0 | enforced (13 vitest) |
| G-POS.1 customer/POS/TID services + event log | 0.3.0 | enforced (GLB_SELFTEST=3 40/40 PASS) — L1 Engineering |
| G-POS.1 UI (Customer/POS/TID/FilterBar/badge) | 0.3.0 | partial — build+typecheck sạch, chờ LEAD nghiệm thu tương tác |
| Undelivered Zalo push + scheduler | — | roadmap/STUB (badge REAL) |
| Thu chi (phần B) | — | roadmap (chờ research) |
| .exe packaging | — | roadmap (Phase C) |
