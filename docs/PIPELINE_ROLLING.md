# PIPELINE CUỐN CHIẾU — hàng đợi thực thi (LEAD điều phối)

> Mục đích: để CMD_BUILD pull tuần tự "cuốn chiếu" mà vẫn tuân **WORKFLOW TỐI THƯỢNG** (freeze tier N trước khi mở tier N+1). Mỗi frame: spec → build → gate độc lập (CMD_AUDIT) → Mr.Long accept (R196) → freeze + tag → mở frame kế.
> LEAD cập nhật cột "Trạng thái" mỗi lần freeze.

| # | Frame | Spec | Gate freeze | Trạng thái |
|---|---|---|---|---|
| F0 | P1.1 giá theo kỳ | `PHASE1_GIA_THEO_KY_SPEC.md` | REV15 73/0 + Prod accept | ✅ FROZEN tag `p1.1-gia-theo-ky` |
| F1 | P1.2 approval + bill bất biến + bulk | `PHASE1_2_APPROVAL_SPEC.md` | typecheck0 / build0 / vitest198 / selftest18 31/0 / REV15 73/0 | ✅ **FROZEN provisional** tag `p1.2` (commit d3e0399) — TẠM NGHIỆM THU 10/7, **chờ Production Validation đầy đủ R196 để nâng L2** |
| F-NOTIF | Đẩy thông báo hủy bill vào hòm thư (UI đã có) | `DISPATCH_PROMPTS_REMAINING.md` (prompt đã QA) | typecheck0/build0/vitest198/selftest18 31-0/selftest19 26-0/guard | ✅ **FROZEN provisional** tag `f-notif` — Engineering Validated 10/7, chờ Production Validation R196 |
| G10.1 | Đóng gói .exe electron-builder | `PHASE_G10…§8` | packaging + login packaged | ✅ done, commit `e7efba0` (WIP, chưa tag tier) |
| **G10.C** | **Gia cố tương tranh** (transaction+guard cho request/approve/reject hủy bill + code_counter) — CHẠM P1.2 freeze, **Mr.Long duyệt 10/7** | `PHASE_G10…§9b CRITICAL-A/HIGH-C/E` | selftest18/19 giữ xanh + selftest race-logic mới + guard | 🔄 **ĐANG** — làm trên SQLite hiện tại, TRƯỚC swap pg |
| G10.2 | **Full-switch Postgres** (B): schema→pg + squash baseline (35 bảng/97 timestamptz) + PrismaPg + gỡ better-sqlite3 + storage/backup pg + harness pg | `PHASE_G10…§8 B` | migrate deploy 0 lỗi + selftest 18/21 trên pg thật | ✅ **done + verify độc lập** (18=31/0, 21=19/0 trên Postgres). WIP toward g10 |
| G10.3+ | Cấu hình LAN (`listen_addresses`/`pg_hba`/firewall) + migrate `glb` prod + UI "Cấu hình máy chủ" | `PHASE_G10…§8` | máy B nối được | ⛔ kế tiếp |
| G10.5 | Stress-race thật (selftest=20) + code_counter atomic (KH/NV) | `PHASE_G10…§9b HIGH-C/E` | N-client trùng mã=0 | ⛔ chưa làm |
| F-NOTIF | **Trung tâm Thông báo** (chuông + hòm thư): đẩy sự kiện yêu cầu/duyệt/từ chối hủy bill + user khóa + backup lỗi + công nợ đến hạn | (viết khi tới) | 🆕 Mr.Long chốt 10/7 **TÁCH RIÊNG** khỏi P1.2 — không nối trong F1 |
| ~~F3~~ | ~~Backlog Nhóm 1 (ngày dd/mm/yyyy, thùng rác UI, màu button)~~ | — | — | ✅ **ĐÃ XONG (verify 10/7)** — KHÔNG cần build frame. Xem "Reality-check F3" dưới. Chỉ còn (tùy chọn) 1 pass QA đồng bộ UI |
| F4 | **Nền móng Nhóm 2** (multi-branch, mã CT 6 số, master data kho/sản phẩm/ĐVT/nhóm hàng) — **frame build THẬT kế tiếp sau G10** | `SPEC_V2_GAP_AND_BACKLOG.md` §B + §E Nhóm 2 | (viết khi tới) | ⛔ chờ Mr.Long duyệt scope |

### Reality-check F3 (verify code thật 10/7 — backlog 9/7 lỗi thời, tránh over-reach xây lại)
| Item backlog | Backlog 9/7 nói | **Thực tế code 10/7** |
|---|---|---|
| E1 Việt hóa | ✅ đợt 1 | ✅ giữ nguyên |
| E2 màu button | 🔶 cần áp | ✅ **ĐÃ CÓ** `Button.tsx` variant `confirm`(xanh)/`edit`(vàng)/`danger`(đỏ)/`neutral` — dùng **137 lần** |
| E3 ngày dd/mm/yyyy tách giờ | ❌ "SAI, dùng toLocaleString" | ✅ **ĐÃ CÓ** `fmtDate/fmtTime/fmtDateTime` từ `@glb/shared`, dùng 14 trang. 0 chỗ `toLocaleString` thật (5 match đều là comment CẤM) |
| E4 Thùng rác UI + phục hồi + cảnh báo liên kết | ❌ "thiếu UI" | ✅ **ĐÃ CÓ** `TrashPage.tsx` (201 dòng, vào menu, `trashRestore`) + `trashLinkSummary` dùng ở CustomersPage |
| Ngày/giờ tách cột (§C) | ❌ SAI | ✅ `fmtDate` + `fmtTime` riêng |
> Bài học (tường minh): suýt spec F3 xây lại thứ đã có. Đúng lớp bug "stale-assumption/over-reach" phiên này → **luôn verify code thật trước khi mở frame**, đừng tin backlog cũ. Nếu muốn, F3 rút gọn thành 1 pass QA đồng bộ UI (không phải build lại).

## Quy tắc cuốn chiếu
1. CMD_BUILD chỉ được chạm code của frame có trạng thái 🔶 ĐANG. Frame ⛔ = cấm.
2. Mỗi bug CMD_AUDIT bắt trong 1 frame = **thất bại quy trình test** → sửa + bổ sung regression/quy trình (TỐI THƯỢNG GLOBAL) trước khi freeze.
3. LEAD (chỉ LEAD) commit/tag/push. CMD_BUILD CẤM.
4. Sau freeze 1 frame: bump `VERSION.md`, ghi `BUGS_FIXED.md`, đổi trạng thái bảng này, mở frame kế.

## Việc còn treo trong F1 (P1.2) — phải xong trước freeze
- [x] CMD_BUILD sửa `preload/index.d.ts` (bị clobber) → web typecheck 0. **XONG (1147 dòng)**
- [x] Fix root cause emit-trap: outDir 2 tsconfig + gitignore + gate typecheck thật. **XONG (B17)**
- [x] Hardlock: guard + pre-commit hook chống clobber. **XONG, tự-kiểm-thử**
- [x] Xác minh độc lập: typecheck node+web 0 / build 0 / vitest 198 / selftest18 31/0 / REV15 73/0 / guard PASS.
- [x] **Quyết định thông báo** → Mr.Long 10/7: **TÁCH frame F-NOTIF riêng**, KHÔNG nối trong P1.2. Gỡ blocker.
- [ ] Dọn code chết `mode:'edit'` trong TransactionForm (CMD_BUILD, nhỏ) — trước freeze.
- [ ] Cập nhật baseline selftest 27→31 trong VERSION.md khi freeze.
- [ ] **CHỜ Mr.Long: Production accept P1.2 (R196)** → rồi LEAD freeze + tag `p1.2`.
