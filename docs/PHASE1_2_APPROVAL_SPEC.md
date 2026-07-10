# Phase 1 — Tier P1.2 · APPROVAL ENGINE + BILL BẤT BIẾN · SPEC + AUDIT GATE

> Thẩm quyền: LEAD chốt 10/7 — **①A** (ghi bill tính ngay; CHỈ HỦY mới cần duyệt) + **② B + phân vai** (Manager/Admin duyệt, tách vai theo cấp, không tự duyệt).
> Tiền đề: **P1.1 đã FROZEN** (tag `p1.1-gia-theo-ky`, commit `f3cfda3`). Tác giả spec+gate: CMD_AUDIT. Thực thi: CMD_BUILD. Ký PASS: LEAD.

---

## 0. Vấn đề P1.2 đóng (REV-B01, phần bất biến)
Hiện `updateTransaction` cho sửa trường tài chính của bill (số tiền/loại thẻ/ngày/khách) → phá tính bất biến chứng từ. LEAD chốt: **bill BẤT BIẾN** — sai thì **hủy có lý do + duyệt Manager/Admin + tạo bill mới**, KHÔNG sửa tại chỗ.

## 1. Quyết định đã khóa
- **①A:** Ghi bill = **tính ngay** (status `POSTED`). Không có bước duyệt khi TẠO. **Chỉ HỦY** bill mới cần duyệt.
- **②B + phân vai:** người **tạo yêu cầu ≠ người duyệt**; duyệt theo cấp (Manager cần Admin duyệt); fallback 1-Admin.

## 2. Dữ liệu (additive — migration timestamp > `20260710120000`, đề xuất `20260710140000_p1_2_approval_engine`)
### 2.1 `Transaction` thêm:
- `status String @default("POSTED")` — `POSTED` | `CANCEL_PENDING` | `CANCELLED`.
- `cancelReason String?` · `cancelledAt DateTime?` · `cancelRequestId Int?` (trỏ approval_request đã duyệt).
- Migration backfill: mọi bill cũ `status='POSTED'`.
### 2.2 Bảng mới `approval_requests` (generic — sau này tái dùng cho phiếu thu/chi):
- `id` · `entityType String` (P1.2 = `'Transaction'`) · `entityId Int` · `action String` (`'CANCEL'`) · `reason String` (bắt buộc) · `status String @default("PENDING")` (`PENDING`|`APPROVED`|`REJECTED`) · `requestedBy Int` · `requestedAt DateTime @default(now())` · `decidedBy Int?` · `decidedAt DateTime?` · `decisionNote String?` · `createdAt/updatedAt`. Index `[entityType, entityId]`, `[status]`. **KHÔNG @@unique** trên cột có thể lặp (B05 n/a — không unique).

## 3. Quyền (seed thêm; R_ADMIN_SUPERUSER auto-cấp cho ADMIN — B06)
- `BILL_CANCEL_REQUEST` — tạo yêu cầu hủy (gán mọi role có `REVENUE_MANAGE`: SALES/ACCOUNTANT/MANAGER/ADMIN).
- `BILL_CANCEL_APPROVE` — duyệt yêu cầu hủy **thường** (MANAGER + ADMIN).
- `BILL_CANCEL_APPROVE_ELEVATED` — duyệt yêu cầu hủy do **người-vốn-có-quyền-duyệt** tạo (ADMIN only). *(Mã hóa "cấp Admin" bằng PERMISSION, không bằng tên role — đúng nguyên tắc tối thượng.)*
- AuditAction mới: `BILL_CANCEL_REQUESTED` · `BILL_CANCEL_APPROVED` · `BILL_CANCEL_REJECTED`.

## 4. Logic (transaction-service + approval-service mới)
### 4.1 Bill BẤT BIẾN
- `updateTransaction`: **BỎ sửa trường tài chính**. Gọi vào → trả `{ok:false, error:'BILL_IMMUTABLE', message:'Bill bất biến — hãy tạo yêu cầu hủy rồi tạo bill mới.'}`. (Xóa đường sửa số tiền/thẻ/ngày/khách/note.) Đóng REV-B01 triệt để (thay bản vá tạm B10).
### 4.2 `requestCancelBill(transactionId, reason)` — quyền `BILL_CANCEL_REQUEST`
- Bill phải tồn tại + `status='POSTED'` (đang CANCEL_PENDING/CANCELLED → từ chối `INVALID_STATE`). `reason` bắt buộc (rỗng → `VALIDATION`).
- Tạo `approval_requests` (PENDING, action CANCEL). Set bill `status='CANCEL_PENDING'`. Audit `BILL_CANCEL_REQUESTED`. Push hòm thư cho người có quyền duyệt (reuse message-service).
### 4.3 `approveCancelBill(requestId, decisionNote?)` — quyền `BILL_CANCEL_APPROVE`
**Phân vai (thứ tự kiểm, sai → audit từ chối R_AUDIT_003):**
1. Request phải `PENDING` (khác → `INVALID_STATE` + audit).
2. Xác định **cấp người tạo**: requester CÓ `BILL_CANCEL_APPROVE`? (Manager/Admin) hay KHÔNG (SALES/nhân viên).
3. **Nếu requester KHÔNG có quyền duyệt** (nhân viên): approver chỉ cần `BILL_CANCEL_APPROVE`, và `approver.id ≠ requester.id`.
4. **Nếu requester CÓ quyền duyệt** (Manager/Admin): approver phải có `BILL_CANCEL_APPROVE_ELEVATED` (Admin), và `approver.id ≠ requester.id`.
5. **Fallback tự duyệt:** cho `approver.id == requester.id` CHỈ khi approver có `BILL_CANCEL_APPROVE_ELEVATED` VÀ là **người DUY NHẤT** (còn sống) có quyền đó → cho duyệt + audit note `"tự duyệt do Admin duy nhất"`. Mọi trường hợp tự duyệt khác → `SELF_APPROVAL_FORBIDDEN` + audit.
- Thành công: bill `status='CANCELLED'` + `cancelledAt` + `cancelReason=request.reason` + `cancelRequestId`; request `APPROVED` + `decidedBy/decidedAt/decisionNote`. Audit `BILL_CANCEL_APPROVED`. Push hòm thư người tạo.
### 4.4 `rejectCancelBill(requestId, decisionNote)` — quyền `BILL_CANCEL_APPROVE`
- Request PENDING → `REJECTED` + decidedBy/at/note (note nên bắt buộc). Bill trở lại `status='POSTED'`. Audit `BILL_CANCEL_REJECTED`. Push hòm thư người tạo.
### 4.4b DUYỆT HÀNG LOẠT (LEAD bổ sung 10/7) — bắt buộc
- `approveCancelBills(requestIds[], decisionNote?)` + `rejectCancelBills(requestIds[], decisionNote)` — **lặp từng request, áp phân vai §4.3 CHO TỪNG cái**. Cái nào approver KHÔNG được phép → **bỏ qua (skip) kèm lý do**, KHÔNG làm hỏng cả loạt. Trả `{approved|rejected: n, skipped: [{id, reason}]}`. **Audit từng request** (không gộp). Trong 1 transaction/loop an toàn.
- **Generic:** vì `approval_requests` là bảng chung → hàm bulk viết theo `requestIds` tổng quát (sau tái dùng cho MỌI loại chứng từ cần duyệt), không hard-code riêng bill.

### 4.5 Doanh thu/Công nợ
- Aggregate doanh thu (`listTransactions.summary`) + `debtSummary`: **LOẠI bill `status='CANCELLED'`** (đóng góp 0). `CANCEL_PENDING` vẫn tính (chưa hủy). Danh sách vẫn HIỂN THỊ bill cancelled (badge "Đã hủy") — không giấu, có audit + lý do.

## 5. UI (CMD_BUILD)
- **RevenuePage:** BỎ nút Sửa bill. Thêm nút **"Yêu cầu hủy"** (modal nhập lý do bắt buộc) cho bill POSTED. Cột **trạng thái**: badge *Đã ghi* / *Chờ duyệt hủy* / *Đã hủy* (đúng R_UI màu). Bill cancelled gạch mờ, không cộng vào KPI.
- **Trang Duyệt hủy (mới)** hoặc tab: người có `BILL_CANCEL_APPROVE` thấy danh sách yêu cầu PENDING **mình được phép duyệt** (đã lọc theo phân vai) → nút Duyệt / Từ chối (nhập note). ConfirmDialog. Hết yêu cầu → empty-state.
- Chuông hòm thư: thông báo khi có yêu cầu mới (cho người duyệt) + khi được duyệt/từ chối (cho người tạo).
- **DUYỆT HÀNG LOẠT (LEAD 10/7):** trang Duyệt hủy dùng lại `components/Selection.tsx` — "Chọn tất cả" (chỉ chọn request đang hiển thị = đã lọc phân vai) + SelectionBar "Duyệt đã chọn"/"Từ chối đã chọn" → `approveCancelBills`/`rejectCancelBills` (§4.4b); toast báo số duyệt + số bỏ qua (skip kèm lý do).
- **SELECT-ALL cho DANH SÁCH USER (LEAD 10/7, R_UI_STANDARD):** `StaffPage` (Nhân sự) thêm select-all + bulk **giống các bảng master** (cùng `Selection.tsx`). Bulk "Xóa đã chọn" = xóa mềm qua ConfirmDialog requirePassword; backend `deleteUsers(ids[], password)` lặp guard `deleteUser` (KHÔNG xóa Admin cuối, KHÔNG tự xóa mình → skip kèm lý do, không hỏng cả loạt, audit từng cái + nhánh từ chối B14). *(Đây là chuẩn UI "chọn tất cả nhất quán mọi list" — áp dần cho mọi list còn thiếu.)*

## 6. Bất biến (KHÓA — audit kiểm)
- **I-A1:** bill POSTED KHÔNG sửa được trường tài chính (`updateTransaction` → BILL_IMMUTABLE).
- **I-A2:** hủy bill CHỈ qua yêu cầu + duyệt; approve xong mới CANCELLED.
- **I-A3:** phân vai — người tạo ≠ người duyệt (trừ fallback 1-Admin); requester cấp Manager/Admin cần approver `ELEVATED` (Admin).
- **I-A4:** bill CANCELLED loại khỏi tổng doanh thu/công nợ; vẫn hiển thị + lý do + audit.
- **I-A5:** mọi nhánh TỪ CHỐI (INVALID_STATE / SELF_APPROVAL_FORBIDDEN / thiếu quyền) ghi audit (R_AUDIT_003, bài học B14).

## 7. AUDIT GATE P1.2 (điều kiện PASS = exit code, CMD_AUDIT tự chạy độc lập)
| # | Hạng mục | Chuẩn PASS |
|---|---|---|
| G1 | typecheck node+web | 0 |
| G2 | build | exit 0 |
| G3 | vitest (+ unit phân-vai nếu tách hàm thuần) | ≥198, 0 fail |
| G4 | selftest APPROVAL mới (=18, `GLB_SELFTEST=18`) | 0 fail, phủ §7.1 |
| G5 | fresh-deploy (migration mới chạy cuối) | 0 |
| G6 | regression cũ REV15 73/0 + TRASH/HSC/STG không vỡ | 0 fail |

### 7.1 Selftest APPROVAL — ca bắt buộc (real service, throwaway DB)
1. **I-A1:** `updateTransaction` sửa số tiền/loại thẻ → `BILL_IMMUTABLE` (không đổi DB).
2. **requestCancel:** thiếu lý do → `VALIDATION`; hợp lệ → request PENDING + bill `CANCEL_PENDING` + audit.
3. **Phân vai:**
   a. SALES tạo yêu cầu → SALES KHÔNG duyệt được (thiếu quyền); Manager duyệt → OK.
   b. Manager tạo yêu cầu → **Manager khác/không-Admin KHÔNG duyệt được** (cần ELEVATED); Admin duyệt → OK.
   c. Manager **tự duyệt** yêu cầu của mình → `SELF_APPROVAL_FORBIDDEN` + audit.
   d. Admin tạo yêu cầu, có Admin thứ 2 → Admin2 duyệt OK; Admin1 tự duyệt (khi có Admin2) → `SELF_APPROVAL_FORBIDDEN`.
   e. **Fallback:** chỉ 1 Admin trong hệ thống, Admin đó tạo + tự duyệt → OK + audit note "tự duyệt do Admin duy nhất".
4. **approve:** bill → `CANCELLED` + cancelledAt + cancelReason + cancelRequestId; request `APPROVED`; audit.
5. **reject:** bill về `POSTED`; request `REJECTED` + note; audit.
6. **I-A4 doanh thu:** tạo 2 bill (350k + 700k), hủy 1 → summary doanh thu + debt LOẠI bill cancelled (còn 700k); bill cancelled VẪN trong danh sách (status CANCELLED).
7. **I-A5 audit nhánh từ chối:** mỗi nhánh từ chối (INVALID_STATE / SELF_APPROVAL_FORBIDDEN / thiếu quyền) → `audit_logs` +1.
8. **Phân quyền:** user không `BILL_CANCEL_REQUEST` → request FORBIDDEN; không `BILL_CANCEL_APPROVE` → approve FORBIDDEN.
9. **Bulk duyệt (§4.4b):** chọn N request trộn (được phép + không được phép theo phân vai) → chỉ approvable bị CANCELLED, còn lại `skipped` kèm lý do; **audit từng cái**; kết quả trả `{approved, skipped[]}`.
10. **Bulk xóa user:** chọn N user trộn (gồm Admin-cuối / chính-mình) → user hợp lệ xóa mềm, Admin-cuối/tự-mình bị `skipped` kèm lý do (không hỏng cả loạt); audit từng cái + nhánh từ chối (B14).

## 8. Ngoài phạm vi P1.2 (không làm)
- Workflow engine generic đầy đủ 6-state cho MỌI chứng từ (phiếu thu/chi/nhập/xuất) — chỉ dựng bảng generic + wire BILL. Chứng từ khác = phase sau.
- G10 (Postgres LAN) — sau Phase 1.

## 9. Quy trình (R7)
Read→Diff→Proposal→**Approval (xong: ①A + ②B-phân-vai)**→Backup (tag p1.1 đã có)→**Patch (CMD_BUILD, cấm commit/tag/push)**→**Regression (CMD_AUDIT tự chạy)**→LEAD nghiệm thu Production→freeze/tag `p1.2`. Mọi bug → BUGS_FIXED + regression trước khi đóng.
