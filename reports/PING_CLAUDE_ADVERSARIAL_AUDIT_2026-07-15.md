# PING CLAUDE — Kiểm toán đối kháng Quản Lý GLB

**Ngày kiểm toán:** 2026-07-15  
**Repo:** `D:\TT HKD AI\tools\quan-ly-glb`  
**Nhánh / HEAD:** `main` / `23e6310`  
**Đối tượng:** trạng thái working tree hiện tại, bao gồm các thay đổi chưa commit  
**Verdict:** **FAIL — không được claim PASS/ship trước khi xử lý và thêm regression test cho nhóm Critical/High.**

**Đợt kiểm toán quan hệ dữ liệu bổ sung:** xem [PING_CLAUDE_DATA_RELATION_AUDIT_2026-07-15.md](./PING_CLAUDE_DATA_RELATION_AUDIT_2026-07-15.md). Hai tài liệu là một gói audit; Claude phải đối chứng cả hai, không được chỉ xử lý báo cáo nền.

> Claude: đừng trả lời bằng giải thích ý định hoặc “UI không gọi như vậy”. Boundary bảo mật nằm ở main process/IPC. Với từng lỗi dưới đây, hãy: (1) xác nhận hoặc phản bác bằng test chạy thật, (2) sửa ở service/guard/transaction, (3) thêm regression test, (4) chạy lại `npm run verify` và `npm run build`, (5) ghi bằng chứng exit-code.

## 1. Tóm tắt điều hành

| ID | Mức | Phát hiện | Trạng thái |
|---|---|---|---|
| AUTH-01 | Critical | Phiên đang sống giữ quyền đã bị thu hồi | Confirmed by code path |
| AUTH-02 | Critical | `user:update` bypass `USER_LOCK` và bảo vệ Admin cuối | Confirmed by code path |
| AUTH-03 | High | User `DISABLED/PENDING` vẫn dùng phiên hiện tại | Confirmed by code path |
| AUTH-04 | Critical | IPC cấu hình PostgreSQL không auth/permission | Confirmed by code path |
| AUTH-05 | High | Race có thể khóa/xóa toàn bộ Admin hoạt động | Confirmed concurrency flaw |
| AUTH-06 | High | `role:update` bypass `ROLE_LOCK/ROLE_UNLOCK` | Confirmed by code path |
| SEC-01 | High | Password PostgreSQL lưu plaintext | Confirmed at rest |
| SEC-02 | High | Restore chấp nhận backup thiếu manifest/checksum | Confirmed by branch logic |
| SEC-03 | Medium/High | Update qua HTTP, chưa có gate chứng minh chữ ký | Risk; cần artifact test |
| SEC-04 | Medium | Electron sandbox bị tắt | Hardening gap |
| OPS-01 | Medium | Init DB lỗi vẫn đăng ký toàn IPC | Confirmed fail-open |
| UI-01 | High | Enter có thể submit destructive confirm nhiều lần | Confirmed race |
| UI-02 | Medium | Banner realtime ACK trước khi reload thành công | Confirmed ordering bug |
| UI-03 | Medium | Poll realtime có thể ghi lùi version | Confirmed async race |
| UI-04 | Medium | Lỗi tải status bị cache rỗng vĩnh viễn | Confirmed cache poisoning |
| UI-05 | Medium | Pagination không reset khi filter đổi nhưng total bằng nhau | Confirmed dependency bug |
| UI-06 | Medium | Modal thiếu semantics/focus trap/restore | Confirmed a11y gap |
| UI-07 | Medium | `SearchSelect` không thể chọn bằng bàn phím | Confirmed a11y/function gap |
| UI-08 | Low/Medium | Tabs thiếu tab semantics/arrow navigation | Confirmed a11y gap |
| UI-09 | Low | Thumbnail có race, có thể hiện nhầm tài liệu | Confirmed async race |
| UI-10 | Low | Loading screen không có status accessible | Confirmed a11y gap |

## 2. Bằng chứng Critical/High

### AUTH-01 — Phiên giữ quyền cũ sau khi bị thu hồi

**Bằng chứng:** `apps/desktop/src/main/auth-service.ts:97-125` snapshot roles/permissions lúc login. Tại `:317-329`, validation mỗi request chỉ reload trạng thái/deleted/force-change-password rồi trả lại `current.user`; không rebuild role/permission. `buildAuthUser` có lọc role ACTIVE tại `:112-115`, nhưng không chạy trong guard mỗi request.

**Tái hiện:** A login có `ROLE_UPDATE`; B gỡ permission hoặc khóa role của A; A gọi `role:update` trong phiên cũ. Guard vẫn đọc permission snapshot và cho phép.

**Tác động:** thu hồi quyền không có hiệu lực; người đã bị hạ quyền tiếp tục thao tác đặc quyền.

**Phản biện bị bác:** “DB đã đổi role” không đủ; code guard không reload permission. Cần test integration hai session chứng minh request sau revoke bị từ chối ngay.

### AUTH-02 — `user:update` bypass khóa user và bảo vệ Admin cuối

**Bằng chứng:** `apps/desktop/src/main/user-service.ts:257-260` chỉ đòi `USER_UPDATE`; `:271-290` chỉ kiểm scope khi roleCodes đổi; `:311-322` ghi thẳng `input.status`. Endpoint khóa chuẩn tại `:352-377` mới có `USER_LOCK` và last-admin guard. IPC tại `apps/desktop/src/main/ipc.ts:134-136` chuyển payload thẳng.

**Tái hiện:** actor chỉ có `USER_UPDATE` gọi `window.glb.userUpdate(adminId, { status: 'LOCKED' })` hoặc payload tương đương qua IPC. Có thể nhắm Admin cuối mà không cần `USER_LOCK`.

**Tác động:** vô hiệu phân tách quyền, manager có thể disable Admin cuối và gây lockout.

**Phản biện bị bác:** TypeScript và UI không phải validation runtime; renderer bị kiểm soát có thể gửi payload tùy ý.

### AUTH-03 — `DISABLED/PENDING` vẫn dùng được phiên

**Bằng chứng:** `auth-service.ts:317-329` chỉ revoke `DELETED`, `LOCKED` hoặc `deletedAt`; không chặn `DISABLED/PENDING`. Login mới có chặn tại `packages/business-rules/src/auth.rules.ts:34-40,92-95`. Heartbeat `auth-service.ts:263-277` cũng không xử lý hai trạng thái này.

**Tái hiện:** user ACTIVE login; admin chuyển status thành DISABLED; user tiếp tục gọi API có permission trong session hiện tại.

**Tác động:** nhân sự đã ngưng/nghỉ vẫn sửa dữ liệu cho tới logout/expiry.

### AUTH-04 — IPC cấu hình DB không xác thực

**Bằng chứng:** `apps/desktop/src/main/ipc.ts:55-57` expose `serverConfig:get/test/save` không auth/permission. `apps/desktop/src/main/db.ts:976-981` dùng password đang lưu nếu input rỗng; `:997-1007` kết nối host do renderer chọn; `:1045-1054` lưu cấu hình rồi disconnect/reinit.

**Tái hiện:** từ renderer/devtools/XSS gọi `serverConfigSave({host:'attacker',port:5432,database:'glb',user:'x',password:'x'})`. Với `test` và password rỗng, credential đang lưu có thể được thử tới host do attacker chọn.

**Tác động:** DoS bền vững, chuyển app sang DB giả, nguy cơ lộ credential và dữ liệu giả.

**Phản biện bị bác:** first-run cần endpoint unauth không có nghĩa endpoint được mở sau khi configured. Cần recovery state machine/allowlist và re-auth/permission khi đã cấu hình.

### AUTH-05 — Race phá invariant Admin cuối

**Bằng chứng:** count Admin tại `user-service.ts:116-125` tách rời update. Lock `:362-377` và delete `:404-418` đều check-then-update ngoài transaction/advisory lock.

**Tái hiện:** có hai Admin A/B; hai client đồng thời khóa/xóa lẫn nhau. Cả hai cùng đọc count=2 rồi cùng update, kết quả có thể còn 0 Admin active.

**Tác động:** lockout toàn hệ thống.

**Phản biện bị bác:** atomic update từng row không làm chuỗi count+update thành atomic. Cần transaction isolation/row or advisory lock và concurrency test.

### AUTH-06 — `role:update` bypass quyền lock/unlock

**Bằng chứng:** `apps/desktop/src/main/role-service.ts:116-140` chỉ yêu cầu `ROLE_UPDATE`, nhận status từ input; `:142-153` ghi `LOCKED/ACTIVE`. Endpoint đúng `setRoleStatus` tại `:172-189` đòi `ROLE_LOCK/ROLE_UNLOCK`.

**Tái hiện:** actor chỉ có `ROLE_UPDATE` gọi `role:update` với `status:'LOCKED'`.

**Tác động:** permission catalog chỉ mang tính hình thức; actor khóa role và ảnh hưởng hàng loạt user.

### SEC-01 — Password PostgreSQL plaintext

**Bằng chứng:** `apps/desktop/src/main/db.ts:500-503` định nghĩa password; `:506-518` đọc JSON; `:1046-1051` `JSON.stringify` toàn config vào `server-config.json`. Trong khi `apps/desktop/src/main/remember.ts:18-21,43-45` đã dùng `safeStorage` cho credential đăng nhập.

**Tái hiện:** đọc `%APPDATA%\@glb\desktop\server-config.json` (xác nhận path thực qua `app.getPath`). Password xuất hiện dạng rõ.

**Tác động:** process cùng user, malware, bản backup/support bundle lấy DB credential và bypass toàn bộ permission/audit của app.

### SEC-02 — Restore không xác minh nguồn/toàn vẹn bắt buộc

**Bằng chứng:** `apps/desktop/src/main/backup-service.ts:401-410` chỉ bắt buộc dump; manifest và checksum tùy chọn. `:412-435` sau đó snapshot rồi `pg_restore --clean` vào production. SHA-256 nếu nằm cùng archive cũng không xác thực nguồn.

**Tái hiện:** lấy ZIP backup, thay `database.dump`, xóa `manifest.json`, gọi restore bằng password Admin; nhánh checksum bị bỏ qua.

**Tác động:** phá hoặc đầu độc toàn DB production.

**Phản biện bị bác:** Admin password chỉ authorize thao tác, không chứng minh archive đáng tin. Manifest/checksum phải bắt buộc và cần chữ ký/MAC với key ngoài archive.

### SEC-03 — Update HTTP, chưa chứng minh code signing

**Bằng chứng:** `apps/desktop/electron-builder.yml:63-70` dùng `http://100.75.194.94:8686/updates/`; `infra/update-feed/server.mjs:76-147` phục vụ tĩnh, không auth. Builder config không có gate certificate/publisher.

**Tác động:** MITM/LAN host có thể thay cả `latest.yml` và EXE; sha512 nằm cùng metadata không xác thực nguồn.

**Điều kiện hạ mức:** chỉ hạ nếu artifact thật vượt `Get-AuthenticodeSignature dist\*.exe`, updater từ chối EXE sai publisher và CI/release gate bắt buộc kiểm tra này. Tailscale không thay thế server authentication, nhất là feed được mô tả listen `0.0.0.0`.

### UI-01 — Destructive confirm double-submit bằng Enter

**Bằng chứng:** `apps/desktop/src/renderer/src/components/ConfirmDialog.tsx:31-38,57-62`. `run()` không guard `busy`; Enter gọi thẳng `run`. Chỉ button bị disabled tại `:76-78`.

**Tái hiện:** nhập đúng password, nhấn Enter nhanh hai lần trước IPC hoàn thành; hai `onConfirm` chạy song song.

**Tác động:** duplicate delete/restore/approve, race và audit/toast trùng.

**Phản biện bị bác:** React state update không phải mutex đồng bộ; component dùng chung không thể giả định mọi backend idempotent.

## 3. Bằng chứng Medium/Low và khoảng trống vận hành

### OPS-01 — DB init fail-open

`apps/desktop/src/main/index.ts:98-104` nuốt lỗi init DB rồi vẫn đăng ký toàn IPC. Khởi động với DB unreachable tạo process ở trạng thái prisma undefined/partial, lỗi handler không nhất quán. Nên fail-closed hoặc chỉ expose allowlist recovery có trạng thái rõ.

### SEC-04 — Electron sandbox tắt

`apps/desktop/src/main/index.ts:35-40` tắt sandbox dù `contextIsolation`/`nodeIntegration` đúng; CSP tại `renderer/index.html:7-9` là điểm tốt. Đây là blast-radius hardening gap, không claim exploit độc lập. Cần thử preload với sandbox bật thay vì dựa vào comment.

### UI-02 — ACK stale trước reload

`renderer/src/lib/realtime.tsx:54-56,61-73`: click gọi `ack()` rồi `onReload(): void`. Nếu reload lỗi, banner mất dù bảng vẫn cũ và cùng token không cảnh báo lại.

### UI-03 — Poll response đảo thứ tự

`renderer/src/lib/realtime.tsx:18-27`: interval khởi tạo async tick chồng nhau, không sequence/monotonic guard. Request A chậm có thể ghi version 10 sau request B version 11.

### UI-04 — Cache rỗng sau lỗi status

`renderer/src/components/StatusBadge.tsx:25-30,40-52`: `{ok:false}` bị cache thành `[]`; lần mount sau thấy cache và không retry. Lỗi tạm thời tồn tại tới restart/force reload.

### UI-05 — Pagination giữ sai trang

`renderer/src/components/Pagination.tsx:6,13-16`: effect chỉ phụ thuộc `total`. Đổi filter A→B nhưng đều 100 dòng vẫn giữ page 2, trái comment hứa reset khi filter đổi.

### UI-06 — Modal accessibility

`renderer/src/components/Modal.tsx:31-58`: thiếu `role=dialog`, `aria-modal`, label linkage, focus trap và restore; nút X `:53-55` không accessible name.

### UI-07 — SearchSelect không dùng được bằng keyboard

`renderer/src/components/SearchSelect.tsx:71-79,94-105`: thiếu combobox/listbox semantics và Arrow/Enter/Escape handlers; `<li>` chỉ click. Input text không commit selection, nên keyboard-only user bị chặn.

### UI-08 — Tabs thiếu semantics

`renderer/src/components/Tabs.tsx:7-8,24-33`: thiếu tablist/tab, aria-selected/controls và ArrowLeft/Right. Enter/Space vẫn dùng được nên không nâng lên High.

### UI-09 — Attachment thumbnail race

`renderer/src/components/Attach.tsx:9-13`: không reset/cancel/sequence promise khi `relPath` đổi. Read A chậm trả sau B có thể ghi URL A cho item B, gây xem nhầm tài liệu.

### UI-10 — Loading không accessible

`renderer/src/App.tsx:74-78`: chỉ có SVG spinner, không `role=status`, aria-live hoặc text accessible.

## 4. Bằng chứng gate đã chạy

| Lệnh | Kết quả |
|---|---|
| `npm run verify` | exit 0; typecheck + 2 guards + 15 test files / 266 tests passed |
| `npm run build` | exit 0; Electron main/preload/renderer build thành công |
| `git diff --check` | không thấy whitespace error; có cảnh báo LF→CRLF |

Build có cảnh báo module `db.ts`, `storage-service.ts`, `health-scan.ts` vừa dynamic vừa static import nên dynamic import không tách chunk. Renderer bundle khoảng 1.97 MB và main bundle khoảng 2.89 MB; đây là cảnh báo hiệu năng/packaging, không được dùng thay bằng chứng lỗi chức năng.

**Kết luận về gate:** test xanh không phủ các boundary quan trọng. Chỉ 15 test files cho hơn 300 source/spec files; nhiều `selftest-*` được bundle nhưng không nằm trong `vitest run` mặc định. PASS hiện tại là false confidence nếu không chạy integration/concurrency/artifact tests.

## 5. Regression tests bắt buộc đề nghị Claude thêm

1. Hai session: revoke permission/lock role rồi request kế tiếp của session cũ phải 403.
2. ACTIVE→DISABLED/PENDING/LOCKED/DELETED đều revoke session theo policy thống nhất.
3. Payload `user:update(status)` không thể bypass `USER_LOCK`, manager scope hoặc last-admin guard.
4. Payload `role:update(status)` không thể bypass `ROLE_LOCK/ROLE_UNLOCK`.
5. Hai transaction đồng thời khóa/xóa hai Admin: invariant `activeAdmin >= 1` luôn giữ.
6. `serverConfig:save/test` sau first-run phải cần auth + permission + re-auth; renderer thường bị từ chối.
7. Server config at-rest không chứa password plaintext.
8. Restore thiếu manifest/checksum, dump bị sửa, checksum bị tính lại đều bị từ chối nếu không có signature/MAC hợp lệ.
9. Artifact updater: EXE unsigned/sai publisher và metadata MITM bị từ chối.
10. ConfirmDialog: spam Enter chỉ phát đúng một promise.
11. Realtime: response cũ không được ghi đè token mới; chỉ ACK sau reload thành công.
12. Status cache failure retry được; pagination reset theo query identity.
13. Keyboard tests cho Modal/SearchSelect/Tabs; Attach không hiển thị kết quả promise lỗi thời.

## 6. Ghi chú chống báo sai

- `packages/database/.env` có `DATABASE_URL` nhưng được ignore bởi `.gitignore:23`; `git ls-files` xác nhận không track. **Không báo secret committed.**
- Mojibake thấy trong PowerShell là vấn đề decode console; **không kết luận source hỏng encoding**.
- Working tree có 32 file modified (217 insertions/54 deletions tại thời điểm audit). Sáu lỗi auth/backend nêu trên nằm trong file sạch so với Git, không phải nhiễu do diff chưa commit.
- Không có file sản phẩm nào bị sửa trong audit; chỉ tài liệu này được tạo.

## 7. Thứ tự sửa đề nghị

1. AUTH-01/02/04/05/06 và SEC-02 trước; đây là authorization/integrity boundary.
2. AUTH-03, SEC-01, SEC-03; sau đó artifact-level verification.
3. UI-01 và realtime races.
4. Fail-closed DB init, sandbox, cache/pagination/a11y.

**Điều kiện PASS mới:** không chỉ `verify/build` xanh; phải có regression test tương ứng cho từng Critical/High, chạy concurrency thật trên PostgreSQL, và kiểm chữ ký artifact update thật.
