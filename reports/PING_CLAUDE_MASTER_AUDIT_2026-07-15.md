# PING CLAUDE — MASTER AUDIT ĐỐI KHÁNG

Repo: `D:\TT HKD AI\tools\quan-ly-glb`  
Ngày: 2026-07-15  
Phạm vi: backend/auth, quan hệ dữ liệu, frontend và red-team của hai phiên audit.

## Quy tắc chống báo cáo sai

Claude phải tự kiểm chứng từng ID bằng agent độc lập. Mỗi ID phải ghi `REPRODUCED`, `REJECTED` hoặc `CONDITIONAL`, kèm command/test, exit-code, dữ liệu trước–sau và regression test. Không chấp nhận phản bác “UI không gọi vậy”. Không sửa theo suy đoán.

Gate hiện tại: `npm run verify` exit 0 (266 test), `npm run build` exit 0; `npm run lint` exit 1 vì không có script lint. Các gate này không phủ race, timezone, GUI và quan hệ DB.

## I. Lỗi đã được chứng minh bằng code path

### AUTH-01 — Phiên sống giữ quyền sau khi thu hồi (Critical)

`auth-service.ts:97-125` snapshot roles/permissions lúc login; `:317-329` chỉ kiểm status/deleted/force-change, không rebuild permissions. A login có quyền, B gỡ quyền, A vẫn gọi API đặc quyền trước expiry.

### AUTH-02 — `user:update` bypass khóa user/Admin cuối (Critical)

`user-service.ts:257-260,271-290,311-322` chỉ yêu cầu `USER_UPDATE`, nhận `input.status`; guard đúng ở `:352-377`. IPC `:134-136` nhận payload tùy ý. Actor quyền thấp có thể gửi LOCKED/DISABLED cho Admin cuối.

### AUTH-03 — DISABLED/PENDING session vẫn dùng được (High)

`auth-service.ts:317-329` không revoke hai status; login mới chỉ chặn ở `auth.rules.ts:34-40,92-95`.

### AUTH-04 — IPC đổi PostgreSQL không auth (Critical)

`ipc.ts:55-57`, `db.ts:976-981,997-1007,1045-1054`: renderer có thể đổi host/credential, gây DoS hoặc gửi credential tới DB giả. First-run không được mở endpoint sau setup.

### AUTH-05 — Race khóa/xóa hết Admin (High)

Count và update tách rời `user-service.ts:116-125,362-377,404-418`; hai client đồng thời có thể cùng vượt kiểm tra last-admin.

### AUTH-06 — `role:update` bypass ROLE_LOCK/UNLOCK (High)

`role-service.ts:116-153` cho phép status qua `ROLE_UPDATE`; endpoint đúng tại `:172-189` mới đòi quyền khóa/mở.

### SEC-01 — PostgreSQL password plaintext (High)

`db.ts:500-518,1046-1051` ghi password rõ vào server-config JSON, trong khi remember credential dùng safeStorage (`remember.ts:18-21,43-45`).

### SEC-02 — Restore không bắt buộc kiểm tra toàn vẹn (High)

`backup-service.ts:401-410` cho phép thiếu manifest/checksum; `:412-435` chạy `pg_restore --clean`. ZIP dump bị thay vẫn restore được.

### FE-01 — Export mất ngày/giờ nhập (High)

`ExportRequestPanel.tsx:259-261` có `reqDate/reqTime`, nhưng payload `:308-323` không gửi hai field; IPC `:325` dùng mặc định. Chọn ngày 2000 rồi đọc DB là bằng chứng trực tiếp.

### FE-02 — Reset filter dùng closure cũ (Medium)

`CustomersPage.tsx:91-96` set state rỗng rồi `setTimeout(reload,0)`; callback dùng state render cũ. Cùng pattern xuất hiện ở nhiều FilterBar.

### FE-03 — IPC reject làm loading treo (High/Medium)

Customers `:69-84`, Staff `:73-79`, Pos `:135-149`, CashEntry `:85-100`, Revenue `:161-185`, Debt `:102-112`, Dashboard refresh `:461` thiếu `try/finally`. Mock một API reject: spinner không tắt.

### FE-04 — Lọc ngày lệch timezone (High/Medium)

`RevenuePage.tsx:132-145`, `DebtPage.tsx:72-78` dùng `new Date(date+'T00:00:00').toISOString()`. Asia/Saigon biến ngày 15 thành UTC ngày 14 17:00.

### FE-05 — POS nhận Infinity/sai số tiền (High)

Red-team xác nhận vị trí đúng `TidPage.tsx:662`: `Number(salePrice)||0`; `Infinity` vượt kiểm tra `>0`, số >2^53 bị làm tròn.

### FE-06 — Export approval dùng POS/TID stale (High)

`ExportApprovalPage.tsx:210-228` tải/lọc danh sách một lần ở renderer; client khác có thể thay đổi tài sản trước submit. Backend phải recheck transaction.

### FE-07 — Modal Enter bypass validation/busy, double-submit (High)

`components/Modal.tsx:39-49` gọi `onSubmit` trực tiếp khi Enter; không biết busy/native validation. Nút X `:53-55` thiếu `type=button`.

### FE-08 — Update chạy nhiều lần (High)

`UpdateBanner.tsx:65-68,75-77` không guard phase/busy; click nhanh gọi nhiều start/install.

### FE-09 — MessagesDrawer báo thành công giả (Medium)

`MessagesDrawer.tsx:46-73` không kiểm `res.ok`, vẫn local-update/toast khi mark-read/mark-all thất bại; reload cũng có race.

### FE-10 — Attachment hiển thị ảnh cũ (Medium)

`Attach.tsx:9-13` không sequence/cancel và không clear URL khi path mới lỗi. Promise A trả sau B ghi/giữ ảnh A.

### FE-11 — Realtime ACK trước reload (Medium)

`lib/realtime.tsx:54-56,61-73`: ACK trước `onReload`; reload fail làm banner biến mất khi bảng còn cũ.

### FE-12 — Realtime BigInt token mất chính xác (High khi token lớn)

`main/realtime-service.ts:23` dùng `Number(t.version)`; hai BigInt khác nhau trên 2^53 có thể bị coi bằng nhau.

### DATA-01 — Export TID SALE không chuyển SOLD (Critical)

`export-request-service.ts:416-455` nhánh **TID direct SALE** tạo DeviceSale/cash nhưng chỉ cập nhật delivered/customer/agent, không set `Tid.status='SOLD'`. Trái `docs/POS_SALE_DEBT_SPEC.md:29-31`.

Red-team đã phản bác phạm vi rộng hơn: POS bán kèm TID có nhánh set SOLD đúng; chỉ giữ lỗi direct Export TID SALE.

## II. Lỗi cần kiểm chứng, không được báo chắc chắn mù

1. **Thiếu FK nghiệp vụ:** schema chủ ý dùng scalar/event-log (“no hard FK”). Chỉ gọi bug nếu raw SQL/restore tạo orphan và không có scanner/reconcile bảo vệ.
2. **Status TEXT không CHECK:** cần đối chiếu spec và chạy SQL/import; nếu service + health scan bảo vệ đầy đủ thì ghi design trade-off.
3. **Trạng thái–quan hệ mâu thuẫn:** phải chạy SQL và chứng minh không có guard/health scan ở mọi writer.
4. **TID lệch customerId/dossierId/hkdName:** chỉ kết luận sau khi spec chọn nguồn sự thật và query UI/report hiển thị ba chủ thể khác nhau.
5. **Soft-delete Customer bỏ sót con:** phải xác định policy lịch sử (restrict/snapshot/archive) rồi mới kết luận.
6. **Live unique chỉ enforce service:** phải chạy hai transaction PostgreSQL đồng thời để chứng minh duplicate sống.
7. **BigInt summary ép Number:** chạy amount `9007199254740993` và so sánh DB/DTO trước khi claim.
8. **txnDate timezone:** kiểm migration column type và hai session timezone, không kết luận chỉ nhìn Prisma.
9. **moneyKind cast mù:** chỉ xảy ra khi raw SQL/import ghi giá trị BOGUS; phải chạy tamper fixture.
10. **customerDeviceSerial null:** chưa chứng minh bắt buộc cho mọi mode; chỉ nâng mức nếu spec yêu cầu.
11. **DateInput không sync prop:** chỉ lỗi nếu test giữ component mounted, đổi prop A→B và submit vẫn A.

## III. Các phản biện đã được ghi nhận

- Không báo “secret committed”: `.env` local bị ignore, không tracked.
- Không dùng mojibake PowerShell làm bằng chứng source hỏng encoding.
- Không gán lỗi POS bán kèm cho nhánh Export TID direct đã được phân biệt.
- Không gọi thiếu FK là lỗi chắc chắn khi constitution/spec cho phép event-log scalar.
- FE-05 dùng vị trí đã red-team xác nhận `TidPage.tsx:662`, không dùng nhầm dòng cũ.

## IV. Yêu cầu Claude điền bằng chứng

| ID | REPRODUCED/REJECTED/CONDITIONAL | Command/test + exit-code | Dữ liệu trước–sau | Sửa + regression |
|---|---|---|---|---|
| AUTH-01…AUTH-06 | bắt buộc từng dòng | bắt buộc | bắt buộc | bắt buộc |
| SEC-01…SEC-02 | bắt buộc từng dòng | bắt buộc | bắt buộc | bắt buộc |
| FE-01…FE-12 | fake Promise/tz/IPC thật | bắt buộc | bắt buộc | bắt buộc |
| DATA-01…DATA-11 | SQL/spec/selftest | bắt buộc | bắt buộc | bắt buộc |

## Điều kiện PASS

Không được claim PASS chỉ vì typecheck/build xanh. Phải xử lý các lỗi đã chứng minh, chạy regression/concurrency/timezone/BigInt tests, và lưu command/output cho mọi mục bị phản bác. Đây là file master duy nhất để Claude đối chứng hai phiên audit và tránh tái diễn báo cáo sai.
