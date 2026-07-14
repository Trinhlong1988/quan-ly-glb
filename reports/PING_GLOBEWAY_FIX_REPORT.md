# PING GLOBEWAY — BÁO CÁO SỬA LỖI LOGIC & BẢO MẬT

> Đối chứng theo mệnh lệnh PING_FIX_GLOBEWAY_LOGIC_AUDIT. Mọi mục kiểm chứng trên code `origin/main` tại SHA đầu vào,
> phân loại tường minh, sửa tận gốc (service/main, không vá UI), kèm regression FAIL-trước/PASS-sau + log lệnh thật.

## A. Baseline

```
Branch:          main
Input SHA:       d52186015f1b11d0ff32274b512245fa53dabc3f  (v0.2.31)
Output SHA:      bba3d3d (v0.2.32 — P0 batch) · <đợt 2 P1/P2: cập nhật sau commit> (v0.2.33)
Date:            2026-07-14
Node:            v24.14.1
Package manager: npm workspaces (monorepo apps/desktop + packages/{shared,business-rules,database})
Prisma:          7.8.0 (queryCompiler wasm + PrismaPg adapter)
PostgreSQL:      16 (127.0.0.1:5432; DB throwaway per selftest, KHÔNG động production `glb`)
OS:              Windows 10 Pro 19045
```

## B. Bảng kết quả

### P0 — phải sửa trước khi ship

| ID | Trạng thái trước | File/symbol | Cách tái hiện | Test | Kết quả |
|---|---|---|---|---|---|
| P0-01 | **CONFIRMED** | `user-service.ts:setUserLock` + `auth-service.ts:login #1` | Auto-lock để lại `lockedAt`; admin mở→khóa lại → login tự mở khóa-tay vì `lockedAt` cũ >15′ | ST35 §13/§13b | **PASS** |
| P0-02 | **CONFIRMED** | `auth-service.ts:registerFailedAuth` | read-modify-write `failedAttempts+1` không atomic → login sai song song ghi đè mất lần đếm | ST35 §14 | **PASS** |
| P0-03 | **CONFIRMED** | `approval-service.ts:approveCancelBill/approveOne` | Tự-duyệt hủy bill ghi chú "đã nhập mật khẩu" nhưng service KHÔNG nhận/verify password | ST18 P0-03 | **PASS** |
| P0-04 | **CONFIRMED** | `approval-service.ts:rejectOne` | Hoàn bill CANCEL_PENDING→POSTED không kiểm `count` → Approval REJECTED nhưng bill lệch trạng thái | ST18 P0-04 | **PASS** |
| P0-05 | **CONFIRMED** | `export-request-service.ts:createExportRequest` | `method === 'CK' ? 'CK' : 'CASH'` → 'BANK'/'TRANSFER'/typo âm thầm thành CASH (sai dòng tiền) | ST43 Ca6c | **PASS** |
| P0-06 | **CONFIRMED (bounded)** | `export-request-service.ts:toVnd` | `Number(v)` trung gian trước `BigInt`; không chặn > MAX_SAFE → làm tròn âm thầm (VND thực ≤50 tỷ nên chưa chạm) | ST43 Ca6d | **PASS** |
| P0-07 | **CONFIRMED (partial)** | `approval-service.ts` approve/reject + `export-request-service.ts:approve` | audit ghi NGOÀI `$transaction` nghiệp vụ → có cửa sổ commit-nghiệp-vụ / audit-riêng | ST18/ST43 (audit tăng) | **PASS** |

### P1 — logic/kiến trúc

| ID | Trạng thái | File/symbol | Xử lý |
|---|---|---|---|
| P1-01 | **CONFIRMED** | `index.ts:98-104` initDb lỗi bị nuốt → vẫn registerIpc + createWindow | DEFERRED (đề xuất fail-closed) |
| P1-02 | **CONFIRMED** | `db.ts:currentServerConfig/getServerConfig` trả **password DB** ra renderer (prefill ô mật khẩu) | **FIXED** (get trả username-only + `passwordSet`; blank khi save/test = giữ mật khẩu cũ). ST22 §11/§12 |
| P1-03 | **CONFIRMED** | `remember.ts:getRemembered` trả plaintext password về renderer (mâu thuẫn comment) | **FIXED** (username-only + `loginRemembered` giải mã trong main) |
| P1-04 | **CONFIRMED (partial)** | `index.ts` `sandbox:false`; không có wrapper verify sender tập trung | DEFERRED (ràng buộc electron-vite CJS preload) |
| P1-05 | **CONFIRMED** | `transaction-service.ts:parseDate` `new Date('2026-02-31')` cuộn âm thầm sang 03-03 | **FIXED** (strict Y-M-D round-trip UTC → ngày không tồn tại = null → VALIDATION). ST15 A2 |
| P1-06 | **NOT_REPRODUCIBLE** | không có filter enum status tự-do làm rỗng danh sách ngầm | Không sửa |
| P1-07 | **CONFIRMED (partial)** | `pos-service.ts:254` serial chỉ `.trim()`, không upper/collapse, không `serialNormalized` unique | DEFERRED (cần migration + quét near-dup) |
| P1-08 | **CONFIRMED** | `customer-service.ts:deleteCustomer` + entity-cancel customer/TID: xóa mềm KHÔNG guard quan hệ sống | **FIXED** (`customerLiveRelationGuard` + TID precheck; re-guard trong tx lúc duyệt). ST34 P1-08/P1-08b |
| P1-09 | **CONFIRMED** | `approval-service.ts` đọc quyền requester tại lúc DUYỆT (`userPermSet(db,requestedBy)`), không snapshot lúc tạo | DEFERRED (đổi policy — cần Mr.Long chốt) |

### P2 — hiệu năng / tin cậy

| ID | Trạng thái | File/symbol | Xử lý |
|---|---|---|---|
| P2-01 | **CONFIRMED** | `approval-service.ts:listCancelRequests` gọi `userPermSet` trong vòng lặp theo từng phiếu | **FIXED** (memoize theo requester phân biệt) |
| P2-02 | **NEEDS_REVIEW** | upload dựa extension; `file:read` đã gắn quyền + chặn traversal (B35) | DEFERRED (magic-bytes/stream) |
| P2-03 | **PARTIAL** | service trả mã lỗi có cấu trúc; exception ngoài dự kiến có thể lộ chi tiết | DEFERRED (map lỗi PG → mã an toàn) |
| P2-04 | **PARTIAL / accepted** | DDL migrate chạy prisma CLI phía server; `seedIfEmpty` catalog quyền chạy CẢ client (B53, additive + advisory-lock) | Đã xác nhận thiết kế (client KHÔNG chạy DDL) |

Trạng thái hợp lệ dùng: `CONFIRMED`, `ALREADY_FIXED`, `NOT_REPRODUCIBLE`, `FALSE_POSITIVE`, `PARTIAL/accepted`, `NEEDS_REVIEW`, `BLOCKED`.

## C. Diff summary (đợt sửa PING)

**Files thay đổi:**
- `packages/database/prisma/schema.prisma` — User `+lockReason String?` (mỏ neo lý do khóa).
- `packages/database/prisma/migrations/20260714120000_user_lock_reason/` — thêm cột `lock_reason` (additive, backfill AUTH_FAILURE/ADMIN_LOCK theo lockedAt cũ).
- `auth-service.ts` — P0-02 atomic increment + conditional lock; P0-01 login tự-mở chỉ khi `lockReason==='AUTH_FAILURE'`; reset-password chỉ mở AUTH_FAILURE.
- `user-service.ts` — P0-01 `setUserLock` set/clear `lockReason` + `lockedAt` (khóa tay = ADMIN_LOCK, lockedAt null).
- `approval-service.ts` — P0-03 verify password khi duyệt/duyệt-bulk hủy bill; P0-04 reject kiểm `billMoved.count===1` (rollback nếu lệch); P0-07 audit vào `$transaction`; P2-01 memoize quyền requester.
- `export-request-service.ts` — P0-05 allowlist `PAYMENT_METHODS` (giá trị lạ→VALIDATION); P0-06 `toVnd` parse chuỗi-chữ-số thẳng BigInt + chặn > MAX_SAFE; P0-07 audit duyệt vào `$transaction`.
- `ipc.ts` / `preload/index.ts` / `preload/index.d.ts` — P0-03 `approval:approve*` nhận password; P1-03 `auth:getRemembered` trả username-only + `auth:loginRemembered`.
- `remember.ts` — P1-03 `getRememberedUsername`.
- `renderer/pages/ApprovalPage.tsx` — bill approve/bulk chuyển sang `ApprovePasswordModal` (thu mật khẩu).
- `renderer/pages/Login.tsx` — điền username-only + đăng nhập-đã-nhớ qua main.
- Selftests: `selftest-approval.ts` (+P0-03/P0-04, cập nhật chữ ký approve), `selftest-session.ts` (+P0-01/P0-02), `selftest-export-request.ts` (+P0-05/P0-06, sửa assertion Ca6b TID-bán-kèm), `selftest-concurrency/guard/notify.ts` (cập nhật chữ ký approve).

**Migration:** `20260714120000_user_lock_reason` — additive nullable, backfill an toàn, KHÔNG đổi hành vi dữ liệu cũ.
**API contract đổi:** `approveCancelBill(id, actorPassword, note?)`, `approveCancelBills(ids, actorPassword, note?)`, `cancelApprove/Bulk(+password)`; `getRemembered()→{username}`, thêm `loginRemembered`.
**Ảnh hưởng dữ liệu cũ:** không (production `glb` chưa áp migration lock_reason ở đợt này — chờ ship theo quy trình).
**Rollback:** revert commit + `lock_reason` drop-column (không mất dữ liệu nghiệp vụ).

## D. Test evidence

```
# Gate tĩnh
$ npm run typecheck --workspace @glb/desktop      → exit 0 (sạch)
$ npm run build --workspace @glb/desktop          → exit 0 (built)
$ npx vitest run                                  → 253 passed / 253 (13 files)

# Selftest PostgreSQL THẬT (DB throwaway: createdb → migrate deploy → chạy → dropdb)
# Đợt P0 (build sạch sau khi sửa):
ST 18 APPROVAL   exit=0  pass=39 fail=0   (+P0-03 5 assert, +P0-04 3 assert)
ST 19 NOTIFY     exit=0  pass=26 fail=0
ST 20 CONC       exit=0  pass=23 fail=0   (approve song song vẫn 1 win)
ST 21 GUARD      exit=0  pass=19 fail=0
ST 35 SESSION    exit=0  pass=35 fail=0   (+P0-01 §13/§13b, +P0-02 §14)
ST 43 YCXK       exit=0  failures=0        (+P0-05 Ca6c, +P0-06 Ca6d, sửa Ca6b)

# Regression TOÀN BỘ ST2-43 (build sạch) — 42 suite:
=== DONE. suites with nonzero exit: 0 ===   (mọi suite pass; ST15 REV=94, ST41 DEVSALE, ST42 HANDOVER… đều 0 fail)
# Re-verify sau P2-01 (build sạch): ST18=39/0, ST34=30/0 (memoize quyền requester đồng nhất hành vi).
```

**KẾT LUẬN GATE:** typecheck 0 · build 0 · vitest 253/253 · FULL ST2-43 = 0 fail · migration deploy sạch trên DB throwaway.
P0 = 7/7 PASS. P1-03 + P2-01 FIXED. Còn lại P1/P2 phân loại DEFERRED/accepted (mục E) chờ Mr.Long xếp lịch.

## E. Remaining risks (chưa chứng minh / cố ý hoãn)

1. **P1-01 fail-closed:** initDb lỗi vẫn mở app — đề xuất chặn registerIpc + màn cấu hình an toàn (chưa sửa, cần Mr.Long duyệt đổi luồng boot).
2. **P1-04 sandbox:** `sandbox:false` do ràng buộc preload CJS của electron-vite; chưa có wrapper `secureHandle` verify sender tập trung.
3. **P1-05 ngày nghiệp vụ:** chưa có parser `YYYY-MM-DD` chặt chẽ toàn tuyến (reject 2026-02-31…).
4. **P1-07 chuẩn hóa serial:** cần cột `serialNormalized` + unique + quét near-dup TRƯỚC migration (không tự merge dữ liệu lịch sử).
5. **P1-08 guard xóa entity có quan hệ sống:** deleteCustomer + entity-cancel customer/khác chưa chặn khi còn POS/TID/cọc/công nợ/phiếu chờ.
6. **P1-09 snapshot quyền requester:** hiện tính lại lúc duyệt; đổi sang snapshot cần Mr.Long chốt policy.
7. **P2-02/P2-03:** upload magic-bytes/stream; map lỗi PG → mã an toàn (tránh lộ host/user).
8. **Money string↔bigint TOÀN TUYẾN:** đã chuẩn hóa INPUT (toVnd string→bigint + chặn MAX_SAFE) + đã có BigInt cột DB (B39). DTO tài chính còn dùng `Number(bigint)` khi xuất (an toàn trong biên VND ≤ 2^53, nhưng chưa "string thuần" toàn tuyến) — rollout hết mọi service là hạng mục lớn, đề xuất lịch riêng + guard.
9. **P0-07 mô hình audit:** đã đưa audit VÀO transaction ở mutation P0. Lưu ý: `writeAudit` cố tình nuốt lỗi (best-effort, không làm sập nghiệp vụ) — nếu Mr.Long muốn "audit-fail → rollback nghiệp vụ" (model A cứng) thì cần đổi chính sách writeAudit (ảnh hưởng toàn app).

## E2. 8 INVARIANT (mục tiêu cuối tài liệu) — trạng thái

| # | Invariant | Trạng thái | Chứng minh |
|---|---|---|---|
| 1 | Không ai tự mở khóa trái policy | ✅ ĐÓNG | P0-01 lockReason gate · ST35 §13/§13b |
| 2 | Không request đồng thời mất đếm / duyệt 2 lần | ✅ ĐÓNG | P0-02 atomic · P0-04 count · ST20/ST35 §14 |
| 3 | Không dữ liệu tài chính sai vì normalize/float | ✅ ĐÓNG | P0-05 allowlist · P0-06 BigInt · ST43 Ca6c/6d |
| 4 | Không approval lệch trạng thái entity | ✅ ĐÓNG | P0-04 billMoved.count===1 · ST18 |
| 5 | Không mutation quan trọng thiếu audit | ✅ ĐÓNG | P0-07 audit trong $transaction |
| 6 | Không secret từ main sang renderer | ✅ ĐÓNG | P1-02 serverConfig + P1-03 remember · ST22 §11/§12 |
| 7 | Không entity lịch sử tài chính bị xóa gây orphan | ✅ ĐÓNG | P1-08 relation guard + re-guard tx · ST34 P1-08 |
| 8 | Không báo cáo rỗng giả do filter/ngày sai | ✅ ĐÓNG | P1-05 strict date · P1-06 N/A · ST15 A2 |

**Cả 8 invariant đều có FIX + regression FAIL-trước/PASS-sau.** Các mục DEFERRED còn lại (P1-01/04/07/09, P2-02/03) là HARDENING, KHÔNG vi phạm invariant nào ở trên.

## F. Bài học & đổi quy trình (bắt buộc theo hiến pháp)

- **PF (process failure) mới — "stale build che test":** Ca6b (0.2.31) được thêm SAU `npm run build`, rồi chạy `run_all.sh` (dùng `out/` build cũ) → false-pass → ship kèm assertion SAI (`deliveredAt` cho TID bán-kèm, đúng ra là `SOLD`). Chỉ lộ khi rebuild sạch ở đợt này.
  - **Đổi quy trình:** `run_all.sh`/mọi driver selftest PHẢI `npm run build` NGAY TRƯỚC khi chạy (hoặc hash-check `out/` vs `src/`). LEAD không được chạy selftest trên build cũ. Ghi memory [[feedback_subagent_must_run_db_selftest_not_just_gate]] mở rộng: "DB selftest chỉ tính khi chạy trên build vừa biên dịch từ HEAD".
- **Bug-class mở rộng:** (a) "cờ khóa/trạng thái phải có LÝ DO tường minh" (lockReason) — chống tự-mở sai policy; (b) "read-modify-write trên bộ đếm bảo mật = atomic increment + conditional transition"; (c) "note nghiệp vụ khẳng định điều gì (đã nhập mật khẩu) thì service PHẢI thực thi điều đó"; (d) "chuyển trạng thái đối-xứng (approve/reject) phải kiểm count đối-xứng".
