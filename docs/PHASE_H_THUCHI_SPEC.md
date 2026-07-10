# PHASE H — QUẢN LÝ THU – CHI (CASHFLOW) — DESIGN SPEC

> Trạng thái: **DRAFT — chờ Mr.Long chốt (R7 Read→Diff→Proposal→Approval)**. KHÔNG build tới khi duyệt.
> Kiến trúc sư thiết kế 10/7. Grounded trên code THẬT của `quan-ly-glb` (schema.prisma, transaction-service, approval-service, dashboard-service, DebtPage) + 2 tài liệu nghiên cứu (`CASHFLOW_MARKET_RESEARCH.md`, `POS_TID_CASHFLOW_DESIGN_PROPOSAL.md`).
> Nguồn phạm vi (chân lý): `Desktop/báo cáo - Copy.md` mục **A→K** + 2 bổ sung LEAD 10/7 (Lợi nhuận Dashboard · Phân loại chất lượng công nợ).
>
> **Nguyên tắc tối thượng của module:** mọi đồng tiền vào/ra hệ thống đi qua **đúng 1 chứng từ nguyên thủy `CashEntry` (phiếu thu/phiếu chi)**. Mọi nghiệp vụ khác (tạm ứng, cọc máy, hoàn cọc, chi lương, thu công nợ) là **chứng từ nghiệp vụ** — khi POSTED **sinh đúng 1 `CashEntry` liên kết**. Nhờ vậy: **Quỹ = Σ CashEntry** luôn cân, KHÔNG bao giờ đếm trùng.

## ✅ QUYẾT ĐỊNH MR.LONG CHỐT 10/7 (khóa — agent build theo đây)
| # | Vấn đề | CHỐT |
|---|---|---|
| Q-A | **Lợi nhuận Dashboard** | **Theo DOANH THU GHI NHẬN (accrual)**: `Lợi nhuận tháng = Σ chênh lệch GD (Transaction, theo txnDate trong tháng) − Σ phiếu chi thực (CashEntry CHI trong tháng)`. **KHÔNG** cash-basis. Thu công nợ = chuyển "phải thu → tiền", KHÔNG tính là doanh thu mới (chống đếm trùng). |
| Q-B | **Phiếu chi có cần duyệt?** | **KHÔNG cần duyệt.** Chỉ ghi audit đầy đủ (người chi, danh mục, số tiền, ngày, hình thức). (KHÁC hủy bill — không qua Approval Engine.) |
| Q-C | **Nợ "không thu hồi được" (BAD)** | **Cờ CẢNH BÁO ĐỎ** trên DebtPage + Dashboard, KHÔNG **tự động** ghi giảm. Ghi giảm = **thao tác TAY** qua nút "Ghi giảm nợ xấu" (xem Q-F, đã chốt LÀM đợt này). |
| Q-D | **Admin đặt lại MK user khác** (lỗ hổng an ninh) | Bắt admin **nhập lại MK ĐĂNG NHẬP của chính mình** (re-auth) → backend verify trước khi reset. *(việc security riêng, không thuộc module thu-chi nhưng ghi ở đây để không quên.)* |
| Q-E | **Mã theo vai trò** | **C: giữ mã NV ổn định + badge vai trò màu (AD/QL/NV) cạnh mã.** KHÔNG ghép chữ vai vào mã (tránh lỗi mã-cố-định-khi-đổi-vai). |
| Q-F | **Ghi giảm nợ xấu (write-off)** — Mr.Long chốt **B 10/7** | **LÀM nút "Ghi giảm nợ xấu"** đợt này. Trên công nợ BAD: thao tác **quyền cao `DEBT_WRITEOFF` + `verifyActorPassword`** → sinh 1 `CashEntry` CHI danh mục hệ thống **"Chi phí nợ xấu"** (`sourceKind=BAD_DEBT`, `affectsPnl=true`) = **công nợ còn lại net-of-settlement** → **trừ thẳng lợi nhuận** + đánh dấu GD đã ghi-giảm (rớt khỏi công nợ, CẤM ghi giảm 2 lần, idempotent). Audit đủ. KHÔNG tự động. Pha **H2b**. Invariant + selftest (đúng số dư còn lại + idempotent). |
| Q-lương | **Chi lương trừ lợi nhuận** — chốt **CÓ** | Chi lương = chi phí thật, `affectsPnl=true`, trừ vào lợi nhuận. |
| Q-cọc | **Cọc/hoàn cọc nhiều máy** — chốt | Cọc = **đơn giá × số máy** (1 máy 5tr → 3 máy 15tr). Hoàn = **số máy thu hồi × đơn giá** (thu 2/3 → hoàn 10tr, giữ 1 máy). Per-máy, hoàn từng phần theo số máy thu hồi. |
| Q6 | **"Số máy chưa cọc" (mục I)** — mặc định | = máy đang giao khách/đại lý (deployed) mà CHƯA có khoản cọc. (đổi mẫu số sau nếu cần.) |

> Các câu chờ còn lại sẽ hỏi khi build tới pha liên quan.

---

## 0. Ánh xạ A→K (+2 bổ sung) → thành phần thiết kế

| Mục báo cáo | Yêu cầu cốt lõi | Bảng dữ liệu | Service/Trang | Pha |
|---|---|---|---|---|
| **A** Danh mục khoản THU | Thêm loại thu (Công nợ KH, Công nợ đối tác, DT bán POS, DT bán TID, DT khác…) + đơn vị tính + kỳ áp dụng | `CashCategory(kind=THU)` | `cash-category-service` · Trang *Cấu hình danh mục thu-chi* | **H1** |
| **B** Danh mục khoản CHI | Tương tự A | `CashCategory(kind=CHI)` | như trên | **H1** |
| **C** Tạm ứng | Hạng mục, người chi ứng, người nhận, CK/tiền mặt, số tiền, ngày, ghi chú, **chứng từ**, **bộ đếm tháng (số tiền + số lần)** | `Advance` (+ `CashEntry` sinh ra) | `advance-service` · Trang *Tạm ứng* | **H3** |
| **D** Mỗi lần THU | Thu của KH/đối tác nào, ngày, số tiền, tùy chọn | `CashEntry(kind=THU)` (+ link `Transaction` khi thu công nợ) | `cash-entry-service` · Trang *Phiếu thu* | **H2** |
| **E** Mỗi lần CHI | Người chi (chọn từ user NV), số tiền, danh mục chi, ngày, CK/tiền mặt | `CashEntry(kind=CHI)` | `cash-entry-service` · Trang *Phiếu chi* | **H2** |
| **F** Lọc báo cáo thu-chi từ ngày → ngày | Báo cáo dòng tiền theo khoảng ngày | (đọc `CashEntry`) | `cashflow-report` · Trang *Báo cáo thu-chi* | **H2**(cơ bản)→**H6**(đầy đủ) |
| **G** Cọc máy | KH/đại lý cọc, ngày, số lượng, chủng loại, đơn vị tính, số tiền | `DeviceDeposit` (+ `CashEntry` THU) | `deposit-service` · Trang *Cọc máy / Hoàn cọc* | **H4** |
| **H** Hoàn cọc | **Xác nhận đã thu hồi máy** (nối giao/thu máy POS = `AssetEvent`), số tiền hoàn, ngày, ai nhận/ai chuyển, chứng từ | `DepositRefund` (+ `CashEntry` CHI) | `deposit-service` | **H4** |
| **I** Thống kê máy cọc | Số máy **đã cọc / chưa cọc / đã hoàn cọc** — tường minh trên UI | (dẫn xuất từ `DeviceDeposit` × `PosDevice`/`PosIntake`) | StatBar trên Trang *Cọc máy* + Dashboard | **H4** |
| **J** Quỹ | Ai giữ quỹ (user), giữ bao nhiêu, thống kê tường minh | `Fund` | `fund-service` · Trang *Quỹ* | **H1**(tạo quỹ)→**H2**(số dư)→**H6**(đối soát) |
| **K** Chi lương | Chi cho NV nào, bao nhiêu, tháng nào, ngày, ai chi, **đã chi / chưa chi** | `SalaryPayment` (+ `CashEntry` CHI khi chi) | `salary-service` · Trang *Chi lương* | **H5** |
| **+LN** Lợi nhuận (LEAD 10/7) | **ACCRUAL (Q-A):** `Lợi nhuận tháng = Σ chênh lệch GD (Transaction theo txnDate) − Σ phiếu chi (CashEntry CHI)`, hiển thị Dashboard, so tháng trước | (đọc `Transaction` + `CashEntry CHI`) | mở rộng `dashboard-service` | **H6** (MVP có thể ở H2) |
| **+CL** Phân loại chất lượng công nợ (LEAD 10/7) | 3 mức Dễ/Khó/Không thu hồi, gắn công nợ, audit + lịch sử, lọc + Dashboard cảnh báo đỏ | `Transaction.debtQuality` (mở rộng) + `DebtQualityLog` | mở rộng `transaction-service` + `DebtPage` | **H2b** |

---

## 1. Quy ước NỀN (bám code hiện tại — CHỐNG bug)

| Quy ước | Giá trị THẬT trong code | Ghi chú thiết kế |
|---|---|---|
| **Tiền (số tiền VND)** | `Transaction.amount:Int`, `revenuePartner:Int` = **VND nguyên, KHÔNG ×1000** (`parseAmount` bắt integer ≥0) | ⚠️ **Đính chính brief:** brief nói "tiền ×1000 milli" — SAI so với code. Chỉ **phần trăm phí** mới ×1000 (`phiMua:Int //×1000`). → **`CashEntry.amount` lưu VND nguyên** cho nhất quán. Nếu lưu ×1000 sẽ lệch toàn bộ tổng với Transaction. (Điểm kiểm chứng bắt buộc — xem §6 rủi ro R3.) |
| **Phần trăm** | `Int ×1000` (3 số thập phân, không float) | Module thu-chi hầu như không dùng %, trừ nếu sau này có phí. |
| **Ngày** | `DateTime @db.Timestamptz(3)`; UI dùng `fmtDate` (dd/mm/yyyy, local) | Nhập `date` → `new Date(v+'T00:00:00')` (local, bài học **B16**). Lọc khoảng: `gte from 00:00`, `lte to 23:59:59`. **M6 (BẮT BUỘC):** MỌI cột `DateTime` mới (kể cả `createdAt/updatedAt/deletedAt/*Date/*At`) PHẢI `@db.Timestamptz(3)` + `@map("snake_case")` đồng bộ toàn schema (khối `createdBy Int? ; createdAt DateTime @default(now())` viết gọn ở §2 chỉ là rút gọn — khi áp Prisma PHẢI bung đủ `@db.Timestamptz(3)` + `@map`). Thiếu Timestamptz → lệch giờ UTC/local + trái convention (audit Nhóm B). |
| **Soft-delete** | `deletedAt/deletedBy` mọi bảng nghiệp vụ | Danh mục đang dùng KHÔNG xóa cứng (R4 §6). |
| **Truy vết** | `createdBy/updatedBy` + `createdAt/updatedAt` | Bắt buộc mọi bảng mới. |
| **Sinh mã** | `nextCode(prefix, txClient)` atomic qua `CodeCounter` | Prefix mới: `PT`(phiếu thu) `PC`(phiếu chi) `TU`(tạm ứng) `CM`(cọc máy) `HC`(hoàn cọc) `CL`(chi lương) **`QU`(quỹ)**. ⚠️ **H6:** prefix quỹ PHẢI 2-4 ký tự — `CODE_PREFIX_REGEX=/^[A-Z]{2,4}$/` (business-rules/asset.rules.ts) → `Q` 1 ký tự làm `nextCode` **throw `Prefix mã không hợp lệ`** (crash tạo quỹ). Đổi `Q`→`QU`. (PT/PC/TU/CM/HC/CL đều 2 ký tự → hợp lệ.) Mã sinh **trong `$transaction`** cùng lúc create (chống race, bài học §D). |
| **Kết quả service** | `MutationResult { ok, error?, message?, id? }` message tiếng Việt cụ thể (R_UX_WARN) | Tái dùng nguyên mẫu transaction-service. |
| **Guard/Audit** | `requirePermission(CODE,{action,targetType})` + `writeAudit` — **mọi nhánh từ chối vẫn audit** | Xóa/hủy cần `verifyActorPassword` (như `deleteTransactions`). |
| **Chống race chuyển trạng thái** | conditional `updateMany({where:{...status:'X'}})` trong `$transaction`, `count===0`→lỗi | Bắt buộc cho POST/HỦY/HOÀN/settle (mẫu approval-service). |

---

## 2. MÔ HÌNH DỮ LIỆU (đề xuất Prisma — CHƯA áp)

### 2.1 `CashCategory` — Danh mục thu/chi (A + B)
```prisma
model CashCategory {
  id           Int       @id @default(autoincrement())
  kind         String    // THU | CHI
  name         String    // "Công nợ khách hàng", "Chi lương", "Doanh thu bán máy POS"...
  unit         String?   // đơn vị tính (mục A: "đồng", "máy", "tháng"...)
  periodType   String?   // NONE | MONTH | DATE_RANGE — kỳ áp dụng (mục A "tháng nào / từ ngày → ngày")
  sourceKind   String    @default("MANUAL") // MANUAL | DEBT_CUSTOMER | DEBT_PARTNER | SALE_POS | SALE_TID | ADVANCE | DEPOSIT | DEPOSIT_REFUND | DEVICE_DEPOSIT | FUND_TRANSFER | SALARY
  affectsPnl   Boolean   @default(true) @map("affects_pnl") // H2/H3: có tính vào lợi nhuận accrual (§5) không
  isSystem     Boolean   @default(false)    // danh mục hệ thống (seed) — không cho xóa
  active       Boolean   @default(true)
  createdBy    Int?      @map("created_by")
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedBy    Int?      @map("updated_by")
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedBy    Int?      @map("deleted_by")
  @@map("cash_categories")
}
```
- `sourceKind` là **cầu nối chống đếm trùng**: category thu **DEBT_CUSTOMER/DEBT_PARTNER** buộc phiếu thu phải chọn đối tượng + (tùy chọn) các `Transaction` để tất toán; **SALE_POS/SALE_TID** = bán thiết bị (KHÔNG nằm trong Transaction — Transaction chỉ là chênh phí quẹt thẻ, xem §3).
- **`affectsPnl` (H2/H3 — cầu nối lợi nhuận accrual §5):** cột quyết định danh mục có vào công thức lợi nhuận không. **Áp CẢ hai vế THU và CHI.**
  - **Seed BẮT BUỘC `affectsPnl=false`** cho các sourceKind KHÔNG phải doanh thu/chi phí: `DEBT_CUSTOMER`, `DEBT_PARTNER` (thu công nợ — đã có trong Transaction accrual, chống trùng), `DEPOSIT`, `DEPOSIT_REFUND`, `ADVANCE`, `DEVICE_DEPOSIT`, `FUND_TRANSFER`.
  - **`affectsPnl=true`** cho: THU bán trực tiếp (`SALE_POS`/`SALE_TID`/DT khác), CHI chi phí vận hành + chi lương (`SALARY`).
  - **Bất biến (I#12/I#13):** danh mục sourceKind ∈ {DEBT_*, DEPOSIT, DEPOSIT_REFUND, ADVANCE, DEVICE_DEPOSIT, FUND_TRANSFER} **KHÔNG được** đặt affectsPnl=true (service chặn khi create/update; selftest assert). Whitelist cuối cùng chờ Mr.Long xác nhận (§7 Q3).
- Seed sẵn các danh mục mục A nêu (đánh `isSystem=true`), gán `affectsPnl` theo quy tắc trên.

### 2.2 `Fund` — Quỹ (J)
```prisma
model Fund {
  id             Int       @id @default(autoincrement())
  code           String    @unique // QU01... (H6: prefix 2 ký tự — Q 1 ký tự vi phạm CODE_PREFIX_REGEX)
  name           String    // "Quỹ tiền mặt VP", "TK VCB 199..."
  type           String    // CASH | BANK | EWALLET
  keeperUserId   Int?      @map("keeper_user_id") // ai giữ quỹ (mục J)
  openingBalance Int       @default(0) @map("opening_balance") // VND
  active         Boolean   @default(true)
  note           String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@map("funds")
}
```
- **Số dư KHÔNG lưu cứng** — tính running: `currentBalance = openingBalance + Σ(CashEntry POSTED THU) − Σ(CashEntry POSTED CHI)` theo `fundId` (thị trường #5 Sapo). Tránh drift.

### 2.3 `CashEntry` — Phiếu thu/chi (chứng từ nguyên thủy — D + E)
```prisma
model CashEntry {
  id           Int       @id @default(autoincrement())
  code         String?   @unique // PT##### / PC#####
  kind         String    // THU | CHI
  categoryId   Int       @map("category_id")
  fundId       Int       @map("fund_id")        // quỹ tiền vào/ra (mục J liên thông)
  amount       Int                              // VND nguyên, > 0
  method       String    // CK | CASH           // hình thức (mục D/E)
  entryDate    DateTime  @map("entry_date") @db.Timestamptz(3)     // ngày thu/chi (local) — M6
  // Đối tượng (một trong các chiều, tùy danh mục):
  customerId   Int?      @map("customer_id")    // KH (mục D)
  partnerId    Int?      @map("partner_id")     // đối tác (mục D)
  payerUserId  Int?      @map("payer_user_id")  // NGƯỜI CHI — bắt buộc khi kind=CHI (mục E)
  receiverUserId Int?    @map("receiver_user_id")// người nhận (thu hộ / hoàn cọc)
  // Chứng từ đính kèm (theo docs/FILE_UPLOAD_CONVENTION.md: path + tên gốc ngoài DB)
  docPath      String?   @map("doc_path")
  docName      String?   @map("doc_name")
  // Back-reference tới chứng từ nghiệp vụ sinh ra phiếu này (chống đếm trùng + truy vết):
  sourceType   String?   @map("source_type")    // ADVANCE | DEVICE_DEPOSIT | DEPOSIT_REFUND | SALARY | FUND_TRANSFER | null(thủ công)
  sourceId     Int?      @map("source_id")
  note         String?
  status       String    @default("POSTED")     // DRAFT | POSTED | CANCELLED  (state machine ghi sổ #8)
  cancelReason String?   @map("cancel_reason")
  cancelledAt  DateTime? @map("cancelled_at") @db.Timestamptz(3)
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([fundId]) @@index([categoryId]) @@index([entryDate]) @@index([status])
  @@index([customerId]) @@index([partnerId])
  @@map("cash_entries")
}
```

### 2.4 `CashDebtSettlement` — nối phiếu thu công nợ ↔ Transaction (CHỐNG ĐẾM TRÙNG — cốt lõi)
```prisma
model CashDebtSettlement {
  id            Int      @id @default(autoincrement())
  cashEntryId   Int      @map("cash_entry_id")   // phiếu thu (kind=THU, category DEBT_*)
  transactionId Int      @map("transaction_id")  // GD được tất toán
  side          String   // PARTNER | SELL  (thu khoản nào của GD — CL_NCC hay CL_KH)
  amount        Int                              // VND áp vào GD này
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([cashEntryId]) @@index([transactionId])
  @@map("cash_debt_settlements")
}
```
- Cho phép **thu công nợ từng phần / gộp nhiều GD**. Khi phiếu thu POSTED: tổng `amount` áp ≤ **công nợ còn lại từng side** của đối tượng.
- **H4 — công nợ còn lại tính NET-OF-SETTLEMENT, KHÔNG dựa cờ `settled` boolean.** Với TỪNG side:
  ```
  còn nợ PARTNER (GD) = revenuePartner − Σ CashDebtSettlement.amount (side=PARTNER, GD đó)
  còn nợ SELL    (GD) = revenueSell    − Σ CashDebtSettlement.amount (side=SELL, GD đó)
  ```
  `debtSummary` (transaction-service) PHẢI viết lại từ công thức net này (hiện tại chỉ `aggregate` `revenuePartner/Sell/Amount` với `where.settled=false` → SAI khi thu **từng phần**: GD còn `settled=false` sẽ tính TOÀN BỘ revenue là nợ, bỏ qua phần đã thu qua CashDebtSettlement → **thu trùng công nợ**).
- **`Transaction.settled` chỉ là HỆ QUẢ, KHÔNG phải nguồn:** `settled=true` được set (trong `$transaction` tạo phiếu thu) **khi và chỉ khi cả 2 side đã thu đủ** (còn nợ PARTNER=0 và SELL=0). Nó chỉ để lọc nhanh/hiển thị; con số công nợ luôn tính net như trên.
- **H5 — KHÓA 1 cơ chế tất toán duy nhất:** sau khi có `createDebtReceipt`, **VÔ HIỆU HÓA nút toggle `settled` thủ công** (`settleTransactions(ids, boolean)` hiện có). `settled` **chỉ** được đổi qua phiếu thu (createDebtReceipt) / hủy phiếu thu — KHÔNG cho người dùng bật/tắt tay (tránh 2 cơ chế mâu thuẫn: toggle tay set settled=true nhưng không có tiền vào quỹ, hoặc đảo ngược net-of-settlement). Xem §3 + §6.
- ⚠️ **Không nhân đôi số liệu:** doanh thu đã ghi ở `Transaction.revenueAmount`; phiếu thu công nợ chỉ **chuyển tiền từ trạng thái "phải thu" → "đã thu tiền mặt/CK vào quỹ"**, KHÔNG cộng lại vào doanh thu (category DEBT_* buộc `affectsPnl=false`, §2.1). Doanh thu accrual (Transaction) và dòng tiền (Cashflow) là **2 lớp khác nhau** — xem §5.
- **Phụ thuộc Q6 (M5):** thu hồi/thu công nợ **từng phần theo số máy hoặc serial** cần Transaction/DeviceDeposit hỗ trợ multi-quantity hoặc serial-level. Hiện `CashDebtSettlement` chia theo **side + amount** (đủ cho thu từng phần theo tiền). Nếu Mr.Long chốt Q6 cần thu hồi từng **máy** riêng → pha H4 mở rộng khóa serial (ghi rõ ở §7 H4).

### 2.5 `Advance` — Tạm ứng (C)
```prisma
model Advance {
  id            Int      @id @default(autoincrement())
  code          String?  @unique // TU#####
  categoryId    Int?     @map("category_id")     // hạng mục tạm ứng (CashCategory kind=CHI, sourceKind=ADVANCE)
  payerUserId   Int      @map("payer_user_id")   // người chi ứng
  receiverUserId Int     @map("receiver_user_id")// người nhận tạm ứng
  method        String   // CK | CASH
  fundId        Int      @map("fund_id")         // M2: DISPLAY-ONLY (nguồn chi ứng để hiển thị) — KHÔNG cộng số dư quỹ; số dư CHỈ tính từ CashEntry.fundId sinh ra (I#1/I#15)
  amount        Int                              // VND
  advanceDate   DateTime @map("advance_date") @db.Timestamptz(3)  // M6
  settledAmount Int      @default(0) @map("settled_amount") // đã hoàn ứng bao nhiêu
  status        String   @default("OPEN")        // OPEN | PARTIAL | CLEARED | CANCELLED
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([receiverUserId]) @@index([advanceDate])
  @@map("advances")
}
```
- **Bộ đếm tháng (mục C):** dẫn xuất — `count(*)` (số lần) + `Σ amount` (số tiền) của `Advance` trong tháng lọc. Hiển thị StatBar.
- Hoàn ứng = 1 `CashEntry` THU liên kết (`sourceType=ADVANCE`), cộng `settledAmount`.

### 2.6 `DeviceDeposit` — Cọc máy (G) + `DepositRefund` — Hoàn cọc (H)
```prisma
model DeviceDeposit {
  id           Int      @id @default(autoincrement())
  code         String?  @unique // CM#####
  depositorType String  @map("depositor_type") // CUSTOMER | AGENT (mục G: khách cọc / chọn đại lý)
  customerId   Int?     @map("customer_id")
  agentId      Int?     @map("agent_id")
  posModelId   Int?     @map("pos_model_id")    // chủng loại máy (mục G)
  quantity     Int      @default(1)             // số lượng
  unit         String?                          // đơn vị tính
  amount       Int                              // số tiền cọc (VND) — mục G "cọc 5.000.000"
  depositDate  DateTime @map("deposit_date") @db.Timestamptz(3)  // M6
  method       String   // CK | CASH
  fundId       Int      @map("fund_id")         // M2: DISPLAY-ONLY — KHÔNG cộng số dư quỹ (số dư từ CashEntry sinh ra)
  refundedAmount Int    @default(0) @map("refunded_amount")
  status       String   @default("HELD")        // HELD | PARTIAL_REFUND | REFUNDED | CANCELLED
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  @@index([customerId]) @@index([agentId]) @@index([posModelId]) @@index([status])
  @@map("device_deposits")
}

model DepositRefund {
  id             Int      @id @default(autoincrement())
  code           String?  @unique // HC#####
  depositId      Int      @map("deposit_id")
  amount         Int                              // số tiền hoàn (mục H)
  refundDate     DateTime @map("refund_date") @db.Timestamptz(3)  // M6
  payerUserId    Int      @map("payer_user_id")   // ai CHUYỂN hoàn
  receiverUserId Int?     @map("receiver_user_id") // ai NHẬN hoàn (khách/đại lý — text hoặc user)
  method         String   // CK | CASH
  fundId         Int      @map("fund_id")         // M2: DISPLAY-ONLY — KHÔNG cộng số dư quỹ (số dư từ CashEntry sinh ra)
  // XÁC NHẬN THU HỒI MÁY (mục H) — nối nghiệp vụ giao/thu máy POS:
  deviceRecovered Boolean @default(false) @map("device_recovered")
  recoveredAssetEventId Int? @map("recovered_asset_event_id") // trỏ AssetEvent RECALL/thu hồi
  recoveredPosSerial String? @map("recovered_pos_serial")
  docPath String? ; docName String?
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  deletedAt DateTime? ; deletedBy Int?
  @@index([depositId])
  @@map("deposit_refunds")
}
```
- **Bất biến H:** `DepositRefund` chỉ POST được khi `deviceRecovered=true` **và** có `recoveredAssetEventId`/serial hợp lệ → chặn hoàn cọc khi máy chưa về (xem §4).
- **Thống kê mục I** (StatBar Trang Cọc máy + Dashboard):
  - *Số máy đã cọc* = `Σ quantity` của `DeviceDeposit` status ∈ {HELD, PARTIAL_REFUND}.
  - *Số máy đã hoàn cọc* = `Σ quantity` status=REFUNDED (hoặc Σ máy có `DepositRefund.deviceRecovered=true`).
  - *Số máy chưa cọc* = (tổng máy đang ở KH/đại lý — từ `PosDevice.status=DEPLOYED` / `PosIntake`) − số máy đã cọc. **Cần Mr.Long chốt mẫu số** (xem §7 Q6).

### 2.7 `SalaryPayment` — Chi lương (K)
```prisma
model SalaryPayment {
  id          Int      @id @default(autoincrement())
  code        String?  @unique // CL#####
  userId      Int      @map("user_id")        // chi cho NV nào (mục K)
  period      String                          // "YYYY-MM" — tháng lương
  amount      Int                              // VND
  status      String   @default("UNPAID")     // UNPAID | PAID (mục K "đã chi / chưa chi")
  paidByUserId Int?    @map("paid_by_user_id") // ai chi
  paidAt      DateTime? @map("paid_at") @db.Timestamptz(3)     // M6
  payDate     DateTime? @map("pay_date") @db.Timestamptz(3)    // ngày chi — M6
  method      String?  // CK | CASH
  fundId      Int?     @map("fund_id")         // M2: DISPLAY-ONLY — KHÔNG cộng số dư quỹ (số dư từ CashEntry sinh ra)
  note String?
  createdBy Int? ; createdAt DateTime @default(now())
  updatedBy Int? ; updatedAt DateTime @updatedAt
  deletedAt DateTime? ; deletedBy Int?
  // M4: KHÔNG @@unique([userId,period]) — có deletedAt (soft-delete) nên unique DB sẽ chặn tạo lại
  //     sau khi xóa mềm (trái B05/DUPLICATE_TRASH). Enforce "1 dòng SỐNG/NV/tháng" ở SERVICE
  //     (query bản deletedAt=null, mẫu FeeRate). Có thể thêm partial unique index (userId,period) WHERE deleted_at IS NULL nếu Postgres hỗ trợ.
  @@index([userId, period]) @@index([status]) @@index([period])
  @@map("salary_payments")
}
```
- Khi chuyển UNPAID→PAID: sinh `CashEntry` CHI (`sourceType=SALARY`), set `paidByUserId/paidAt/payDate`.

### 2.8 `DebtQualityLog` — Lịch sử đổi phân loại công nợ (LEAD 10/7)
Mở rộng `Transaction`: thêm cột `debtQuality String @default("EASY") // EASY | HARD | BAD` (+ index).
```prisma
model DebtQualityLog {
  id            Int      @id @default(autoincrement())
  transactionId Int      @map("transaction_id")
  fromQuality   String?  @map("from_quality")
  toQuality     String   @map("to_quality")
  reason        String?
  actorUserId   Int      @map("actor_user_id")
  createdAt     DateTime @default(now())
  @@index([transactionId])
  @@map("debt_quality_logs")
}
```
**Gắn ở đâu — phân tích:** gắn **mức từng khoản (Transaction)**, KHÔNG chỉ mức khách. Lý do: 1 khách có thể có món cũ khó thu + món mới dễ thu; chất lượng thay đổi theo từng lần quẹt/từng kỳ. → nguồn chuẩn = `Transaction.debtQuality`.
Có thể thêm `Customer.defaultDebtQuality` (tùy chọn, làm **giá trị mặc định** khi tạo GD mới) — nhưng con số thống kê luôn tính từ Transaction. (Đề xuất: H2b làm mức Transaction trước; default-per-customer để pha sau nếu Mr.Long cần.)

### 2.9 `AppliedMigration` — cờ data-migration một-lần (H7 + tương lai)
```prisma
model AppliedMigration {
  id        Int      @id @default(autoincrement())
  key       String   @unique                                    // 'H_grant_cashflow_perms_v1'
  appliedAt DateTime @default(now()) @map("applied_at") @db.Timestamptz(3)
  note      String?
  @@map("applied_migrations")
}
```
- Chốt cho các bước migration dữ liệu chạy trong `seedIfEmpty` (server-role) — chống chạy lại (H7). Idempotent: có key → skip.

---

## 3. LIÊN THÔNG với dữ liệu ĐÃ CÓ (không dựng trùng)

| Đã có | Thu-chi NỐI vào thế nào |
|---|---|
| `Transaction` (doanh thu quẹt thẻ = CL_NCC + CL_KH; `settled` bool; `revenuePartner/Sell/Amount`) | **Công nợ = revenue TỪNG side − Σ CashDebtSettlement (net, H4)**, KHÔNG dựa cờ `settled`. Phiếu thu danh mục DEBT_* **tất toán** GD qua `CashDebtSettlement`; `settled=true` chỉ là hệ quả khi cả 2 side thu đủ. **H5: nút toggle `settleTransactions` thủ công BỊ VÔ HIỆU** — `settled` chỉ đổi qua phiếu thu. KHÔNG tạo bảng công nợ mới. |
| `Customer` (KH##), `Partner`, `Agent` | Đối tượng của phiếu/cọc — chọn từ danh sách sẵn (như DebtPage). |
| `PosDevice`, `PosModel`, `PosIntake`, `AssetEvent`, `PosTidBinding` | Cọc/hoàn cọc trỏ `posModelId`; xác nhận thu hồi máy trỏ `AssetEvent` (RECALL). |
| `User` (NV##) | Người chi/nhận, người giữ quỹ, đối tượng chi lương. |
| `ApprovalRequest` (generic engine) | Tái dùng cho **duyệt hủy/duyệt chi** phiếu (entityType='CashEntry') — xem §7 Q1. |
| `Fund` ↔ `CashEntry` | Chuyển quỹ = **cặp** CashEntry (CHI quỹ A + THU quỹ B, `sourceType=FUND_TRANSFER`) — thị trường #7, KHÔNG tính vào tổng dòng tiền báo cáo. |
| `dashboard-service` | Mở rộng `DashboardStats` thêm khối Lợi nhuận + công nợ theo mức. |

**Bán máy POS/TID (danh mục SALE_POS/SALE_TID) ≠ Transaction:** Transaction là chênh phí **quẹt/rút thẻ**. Bán thiết bị vật lý là dòng tiền riêng → ghi thẳng `CashEntry` THU, KHÔNG đụng Transaction. Không có rủi ro trùng ở đây.

---

## 4. BẤT BIẾN NGHIỆP VỤ (invariants — chuyển thành selftest)

1. **Quỹ cân:** với mọi quỹ, `openingBalance + Σ THU_POSTED − Σ CHI_POSTED = currentBalance` (tính lại từ DB, không đọc số cứng). Selftest tạo N phiếu → assert.
2. **Thu công nợ ≤ công nợ còn lại (NET-OF-SETTLEMENT, H4):** với TỪNG side, `Σ CashDebtSettlement.amount(side) ≤ revenue(side) − Σ đã settle trước đó`. **KHÔNG** dùng cờ `settled` để tính nợ còn lại. Vượt → `error:'DEBT_OVERPAY'`. Selftest: thu 1 phần GD → GD vẫn hiện đúng phần nợ CÒN LẠI (không phải toàn bộ revenue), thu tiếp không cho vượt.
3. **Phiếu chi bắt buộc `payerUserId`** (mục E). Thiếu → VALIDATION.
4. **Số tiền > 0 nguyên**, VND (không âm, không thập phân, không ×1000). Tràn: chặn > `Number.MAX_SAFE_INTEGER` (thực tế đặt trần ví dụ 1e15).
5. **Hoàn cọc ≤ tiền đã cọc:** `Σ DepositRefund.amount ≤ DeviceDeposit.amount`. Vượt → `REFUND_OVERFLOW`.
6. **Hoàn cọc cần xác nhận thu hồi máy:** POST `DepositRefund` yêu cầu `deviceRecovered=true` + AssetEvent/serial hợp lệ. Thiếu → `DEVICE_NOT_RECOVERED`.
7. **Tạm ứng: bộ đếm tháng** = số lần + tổng tiền trong tháng khớp dữ liệu.
8. **Chi lương 1 dòng SỐNG/NV/tháng (M4 — enforce Ở SERVICE, KHÔNG `@@unique` DB):** vì có `deletedAt` (soft-delete), `@@unique([userId,period])` DB sẽ **chặn tạo lại** sau khi xóa mềm (trái bài học B05/DUPLICATE_TRASH — dòng "rác" giữ chỗ). → BỎ `@@unique` khỏi schema; service upsert kiểm tra bản `deletedAt=null` (mẫu FeeRate). Selftest: xóa mềm lương tháng 7 rồi tạo lại → PHẢI thành công; đồng thời cấm 2 bản sống cùng (userId,period).
9. **Chuyển trạng thái nguyên tử** (POST/HỦY/tất toán qua phiếu thu): conditional `updateMany` trong `$transaction`, thua → lỗi, không đếm trùng. **H5:** KHÔNG toggle `settled` thủ công.
10. **Ngày local:** phiếu ngày 2026-07-01 phải rơi đúng kỳ tháng 7 khi lọc/tổng (bài học B16).
11. **BAD không tự trừ doanh thu đã ghi** (mặc định §0 Q-C) — chỉ gắn cờ; lợi nhuận accrual (§5) ĐÃ gồm doanh thu BAD → Dashboard cảnh báo (M1); ghi giảm **chỉ khi Mr.Long chốt** (§7 Q4).
12. **`affectsPnl` chặn danh mục nội bộ (H2/H3):** danh mục sourceKind ∈ {DEBT_CUSTOMER, DEBT_PARTNER, DEPOSIT, DEPOSIT_REFUND, ADVANCE, DEVICE_DEPOSIT, FUND_TRANSFER} **KHÔNG được** `affectsPnl=true`. Service create/update chặn → `PNL_FLAG_FORBIDDEN`. Selftest assert.
13. **Lợi nhuận KHÔNG double-count:** selftest dựng 1 GD (revenue R) rồi thu công nợ đủ (CashEntry DEBT_* = R) → `profitByMonth` của tháng đó = **R một lần** (không phải 2R). Đồng thời chuyển quỹ (FUND_TRANSFER cặp) KHÔNG đổi lợi nhuận; hoàn cọc/chi tạm ứng KHÔNG vào lợi nhuận.
14. **Migration quyền idempotent (H7):** trên DB đã có role cũ, sau `seedIfEmpty` MANAGER/ACCOUNTANT có quyền thu-chi; chạy lại boot KHÔNG cấp lại quyền admin đã cố ý gỡ (ngoài whitelist). Selftest "DB tiến hóa".
15. **`fundId` trên chứng từ nghiệp vụ = display-only (M2):** số dư quỹ CHỈ tính từ `CashEntry.fundId` (I#1). `Advance.fundId`/`DeviceDeposit.fundId`/`SalaryPayment.fundId` **KHÔNG** được cộng vào số dư (đã có CashEntry liên kết mang fundId). Selftest: tạo Advance có fundId + CashEntry sinh ra → số dư quỹ chỉ đổi 1 lần (theo CashEntry), không đếm trùng.

---

## 5. LỢI NHUẬN Ở DASHBOARD — ACCRUAL (Q-A đã CHỐT) — chống đếm trùng + chống lẫn dòng tiền nội bộ

> **KHÓA THEO §0 Q-A (accrual). KHÔNG cash-basis. Toàn spec KHÔNG chỗ nào nói "Lợi nhuận chỉ dùng CashEntry".**

**Công thức chốt (accrual, theo kỳ tháng):**
```
Lợi nhuận(tháng) = THU_LN(tháng) − CHI_LN(tháng)
```
Đây là **HYBRID** (xem M1): vế THU là **doanh thu GHI NHẬN** (accrual, dù chưa thu tiền) + doanh thu bán máy đã lập phiếu; vế CHI là **chi phí thực chi bằng tiền** (cash) đã loại các khoản KHÔNG phải chi phí. Cố ý hybrid để không double-count công nợ và không trừ nhầm các dòng tiền nội bộ.

### 5.1 Vế THU của lợi nhuận (H3 — accrual) — cột `affectsPnl` áp cả THU
```
THU_LN(tháng) =
    Σ Transaction.revenueAmount   (status POSTED, deletedAt=null, theo txnDate trong tháng)   ← doanh thu chênh phí quẹt/rút thẻ, ACCRUAL
  + Σ CashEntry(kind=THU, POSTED, category.affectsPnl=true)  (theo entryDate trong tháng)     ← doanh thu bán trực tiếp (SALE_POS/SALE_TID/DT khác)
```
**LOẠI khỏi vế THU (affectsPnl=false hoặc theo sourceKind):**
- `DEBT_CUSTOMER` / `DEBT_PARTNER` (thu công nợ) — **đã nằm trong `Transaction.revenueAmount` accrual rồi**; cộng lại = **đếm trùng đúng khoản đó 2 lần**. → category DEBT_* buộc `affectsPnl=false`.
- `DEPOSIT` (thu cọc máy) — tiền giữ hộ, KHÔNG phải doanh thu.
- Hoàn ứng (ADVANCE-clear, thu lại tiền tạm ứng) — trả về quỹ, KHÔNG phải doanh thu.
- `FUND_TRANSFER` (chuyển quỹ THU vế nhận) — dòng tiền nội bộ.

### 5.2 Vế CHI của lợi nhuận (H2 — chỉ chi phí thật) — cột `affectsPnl`
```
CHI_LN(tháng) = Σ CashEntry(kind=CHI, POSTED, category.affectsPnl=true)  (theo entryDate trong tháng)
```
**LOẠI khỏi vế CHI** (những khoản CHI KHÔNG phải chi phí — nếu để affectsPnl=false):
- `DEPOSIT_REFUND` (hoàn cọc cho khách) — trả lại tiền giữ hộ.
- `ADVANCE` (chi tạm ứng) — chưa phải chi phí, sẽ hoàn ứng/quyết toán sau.
- `FUND_TRANSFER` (chuyển quỹ CHI vế nguồn) — dòng tiền nội bộ.
- `DEVICE_DEPOSIT` — (không phát sinh CHI; liệt kê để rõ ranh giới).
- Chi lương (SALARY) **LÀ chi phí thật → affectsPnl=true**. (Danh mục nào affectsPnl xem §7 Q3 — **cần Mr.Long xác nhận whitelist**.)

> ⚠️ **KHÔNG cộng cả CashEntry-thu-công-nợ lẫn Transaction.revenueAmount** — đó chính là bẫy double-count. Ranh giới do `affectsPnl` + `sourceKind` bảo vệ (invariant I#12/I#13, selftest bắt buộc).

**Hiển thị Dashboard (KpiCard sẵn có, mở rộng `DashboardStats`):**
- KpiCard *Doanh thu ghi nhận tháng* · *Chi phí tháng* · *Lợi nhuận (accrual)* (xanh nếu ≥0, đỏ nếu <0) · *So tháng trước* (Δ%).
- (Tùy chọn phụ) khối "Dòng tiền thực" (thực thu/thực chi từ CashEntry) để đối chiếu — **KHÔNG phải ô Lợi nhuận**; chỉ là chỉ số thanh khoản, tách bạch rõ để không nhầm với lợi nhuận accrual.
- `dashboard-service.getStats` thêm `pnl: { month, revenueAccrual, expense, profit, prevProfit }` (revenueAccrual gộp Transaction theo `txnDate` local + CashEntry THU affectsPnl theo `entryDate`; expense gộp CashEntry CHI affectsPnl theo `entryDate`). Trả cả khi 0 (empty-state, như pattern hiện tại).

---

## 5b. PHÂN LOẠI CHẤT LƯỢNG CÔNG NỢ (bổ sung LEAD 10/7)

- **3 mức:** `EASY` Dễ thu hồi · `HARD` Khó thu hồi · `BAD` Không có khả năng thu hồi.
- **Gắn:** cột `Transaction.debtQuality` (mức từng khoản — phân tích §2.8). Mặc định `EASY` khi tạo GD.
- **Ai đổi:** quyền mới `DEBT_CLASSIFY`. Đổi phải ghi `DebtQualityLog` (from→to + reason + actor) + `writeAudit`. Chỉ đổi được GD **còn nợ** (còn nợ PARTNER hoặc SELL > 0 theo net-of-settlement H4 — thu đủ rồi thì không còn là công nợ, chặn hoặc chỉ cho xem). KHÔNG dùng cờ `settled` làm điều kiện (dùng net).
- **Hiển thị DebtPage:** StatBar 3 ô đếm theo mức (số GD + tổng tiền mỗi mức); FilterBar thêm chọn mức; BAD tô **đỏ** (StatusPill `bg-danger/10`).
- **Dashboard:** khối *Công nợ theo chất lượng* — tổng tiền EASY/HARD/BAD; **BAD = cảnh báo đỏ** (gợi ý trích lập/ghi giảm).
- **Ảnh hưởng lợi nhuận (phản biện — M1):** lợi nhuận §5 là **ACCRUAL** nên **doanh thu của GD bị đánh BAD ĐÃ nằm trong lợi nhuận** (ghi nhận theo txnDate dù chưa thu tiền). ⚠️ Nghĩa là **nợ BAD làm PHỒNG lợi nhuận accrual** — đây là điểm cần cảnh báo rõ trên Dashboard. Theo §0 Q-C: BAD **chỉ CỜ ĐỎ, KHÔNG tự ghi giảm** (khóa). Để ngỏ đường xử lý sau: khi Mr.Long chốt (§7 Q4) → tạo danh mục CHI **"Chi phí nợ xấu" với `affectsPnl=true`** (bút toán chi phí, khớp mô hình affectsPnl §5.2) HOẶC ghi giảm doanh thu accrual — **cần chốt**. Trước khi chốt: giữ nguyên cờ đỏ + hiển thị "Lợi nhuận accrual đã gồm nợ BAD chưa trích lập" cạnh KpiCard.

---

## 6. SERVICE · IPC · UI · PHÂN QUYỀN

### 6.1 Service + method (mẫu transaction-service; mọi method guard + audit)
| Service | Method chính |
|---|---|
| `cash-category-service` | `list(filter)` `create` `update` `remove(pwd)` (chặn xóa nếu đang dùng → `IN_USE`) |
| `fund-service` | `list` `create` `update` `remove` `balance(fundId, dateTo?)` (running) |
| `cash-entry-service` | `list(filter)` `summary(filter)` `create(input)` `cancel(id, reason)` `remove(ids,pwd)`; thu công nợ: `createDebtReceipt(input, settlements[])` (ghi CashDebtSettlement + set `Transaction.settled=true` **chỉ khi cả 2 side net=0**, trong 1 `$transaction`; **M3:** hủy phiếu thu công nợ PHẢI xóa/đảo CashDebtSettlement + tính lại `settled` cùng transaction) |
| `advance-service` | `list` `create` `clear(id, cashEntry)` (hoàn ứng) `cancel`; `monthlyCounter(filter)` |
| `deposit-service` | `list` `create` `refund(input)` (guard thu hồi máy) `cancel`; `deviceStats(filter)` (mục I) |
| `salary-service` | `list(period)` `create/upsert` `pay(id, input)` `unpay`(sửa)` cancel`; **M4:** upsert enforce "1 dòng sống/NV/tháng" ở SERVICE (query bản `deletedAt=null`), KHÔNG dựa `@@unique` DB |
| `debt-quality` (trong transaction-service) | `classify(transactionId, quality, reason)` `qualityHistory(transactionId)` `debtByQuality(filter)`; **H4: viết lại `debtSummary`** = revenue từng side − Σ CashDebtSettlement (net), KHÔNG dùng `where.settled=false` |
| `transaction-service.settleTransactions` | **H5: VÔ HIỆU HÓA (deprecate).** Không expose IPC/UI toggle tay; `settled` chỉ đổi qua `createDebtReceipt`/hủy phiếu thu. Giữ hàm nội bộ (nếu cần) nhưng KHÔNG cho gọi từ renderer. |
| `cashflow-report` | `report(filter)` (nhóm theo ngày/danh mục/quỹ) `profitByMonth()` (Dashboard, **accrual** §5: Σ Transaction.revenueAmount theo txnDate + Σ CashEntry affectsPnl) |

Kết quả `MutationResult` message VN cụ thể (R_UX_WARN): `DEBT_OVERPAY`→"Số thu vượt công nợ còn lại (còn X đ).", `REFUND_OVERFLOW`→"Hoàn cọc vượt số đã cọc.", `DEVICE_NOT_RECOVERED`→"Chưa xác nhận thu hồi máy — không hoàn cọc được.", `IN_USE`→"Danh mục đang được dùng ở N phiếu, không xóa được.", `PNL_FLAG_FORBIDDEN`→"Danh mục loại này không được tính vào lợi nhuận." …

### 6.2 IPC (mẫu `ipcMain.handle('domain:action', …)` trong ipc.ts)
`cashCategory:list|create|update|remove` · `fund:list|create|update|remove|balance` · `cashEntry:list|summary|create|createDebtReceipt|cancel|remove` · `advance:list|create|clear|cancel|counter` · `deposit:list|create|refund|cancel|stats` · `salary:list|upsert|pay|unpay|cancel` · `debt:classify|qualityHistory|byQuality` · `cashflow:report|profitByMonth`.
→ Khai đủ DTO/method trong **`preload/index.d.ts`** (FILE BẢO VỆ — chỉ CMD_BUILD chỉnh, kèm review).

### 6.3 Trang UI (tái dùng KpiCard/StatBar·StatusPill·FilterBar·Field·Button·ConfirmDialog·toast·exportCsv·`fmtDate`·`money()`)
1. **Cấu hình danh mục thu-chi** (H1) — 2 tab THU/CHI, cột đơn vị + kỳ.
2. **Quỹ** (H1/H2) — danh sách quỹ + người giữ + số dư running; StatBar tổng quỹ.
3. **Phiếu thu** (H2) — form + list realtime; thu công nợ chọn đối tượng → hiện GD chưa settled để tất toán.
4. **Phiếu chi** (H2) — form (người chi bắt buộc) + list.
5. **Báo cáo thu-chi** (H2→H6) — FilterBar **từ ngày→đến ngày** (mục F) + danh mục/quỹ/đối tượng; bảng + tổng + Xuất Excel.
6. **Tạm ứng** (H3) — list + StatBar bộ đếm tháng (số lần · tổng tiền).
7. **Cọc máy / Hoàn cọc** (H4) — 2 khối; StatBar mục I (đã cọc/chưa cọc/hoàn cọc).
8. **Chi lương** (H5) — lọc theo tháng; StatusPill Đã chi/Chưa chi; nút "Đánh dấu đã chi".
9. **Dashboard** (H6) — thêm KpiCard Lợi nhuận + khối công nợ theo chất lượng.
*Mỗi trang có bộ đếm trực quan (StatBar/KpiCard) — yêu cầu chung Mr.Long.*

### 6.4 Phân quyền (thêm vào `permissions.ts`, group "Thu – Chi")
| Code | Ý nghĩa | Gợi ý gán |
|---|---|---|
| `CASHFLOW_VIEW` | Xem thu-chi/quỹ/báo cáo | ADMIN, MANAGER, ACCOUNTANT |
| `CASHFLOW_CONFIG` | Cấu hình danh mục + quỹ | ADMIN, ACCOUNTANT |
| `CASH_RECEIPT_CREATE` | Lập phiếu thu | ADMIN, MANAGER, ACCOUNTANT |
| `CASH_PAYMENT_CREATE` | Lập phiếu chi | ADMIN, ACCOUNTANT |
| `CASH_ENTRY_CANCEL` | Hủy/ xóa phiếu | ADMIN, MANAGER |
| `CASH_ENTRY_APPROVE` | Duyệt phiếu (nếu bật, §7 Q1) | ADMIN |
| `ADVANCE_MANAGE` | Tạm ứng | ADMIN, MANAGER, ACCOUNTANT |
| `DEPOSIT_MANAGE` | Cọc/hoàn cọc | ADMIN, MANAGER |
| `SALARY_MANAGE` | Chi lương | ADMIN |
| `DEBT_CLASSIFY` | Đổi phân loại chất lượng công nợ | ADMIN, MANAGER |
Kiểm quyền **bằng code**, không tên role.

**H7 — MIGRATION QUYỀN MỘT LẦN, IDEMPOTENT (chống LẶP bug 9/7 "quyền mới không gán role cũ"):**
- Bối cảnh code THẬT (`db.ts seedIfEmpty`): `DEFAULT_ROLE_PERMISSIONS` **chỉ gán cho role vừa TẠO MỚI** (`freshlyCreatedRoleCodes`). ADMIN được vòng `R_ADMIN_SUPERUSER` đồng bộ ĐỦ mọi quyền mỗi boot. Nhưng **MANAGER/ACCOUNTANT đã tồn tại** thì nhánh `if (!freshlyCreatedRoleCodes.has(roleCode)) continue;` **BỎ QUA** → các quyền thu-chi MỚI (`CASHFLOW_VIEW`, `CASH_RECEIPT_CREATE`, `ADVANCE_MANAGE`, `DEBT_CLASSIFY`…) **KHÔNG bao giờ** tới role cũ ⇒ menu Thu-Chi ẩn với MANAGER/ACCOUNTANT hiện hữu.
- **KHÔNG được** gỡ gate `freshlyCreatedRoleCodes` (nó cố ý bảo toàn chỉnh tay của admin — LEAD lock 9/7). Thay vào đó: thêm **bước migration một lần idempotent, TÁCH KHỎI nhánh freshly-created**, chạy trong `seedIfEmpty` (chỉ server-role), cấp một-lần các quyền thu-chi cho MANAGER/ACCOUNTANT hiện hữu:
  - **Cờ chốt:** schema HIỆN CHỈ có `CodeCounter` (không có bảng Setting/migration). → thêm bảng nhỏ mới **`AppliedMigration { key String @unique, appliedAt DateTime @db.Timestamptz(3) }`** làm cờ một-lần: nếu `key='H_grant_cashflow_perms_v1'` đã có → skip. Chưa có → `rolePermission.upsert` các permCode thu-chi cho MANAGER/ACCOUNTANT (theo whitelist §6.4) rồi ghi cờ, tất cả trong 1 `$transaction`. **Idempotent** (upsert + cờ) — boot sau KHÔNG cấp lại quyền admin đã cố ý gỡ. (Bảng này cũng dùng lại cho các data-migration H khác sau này.)
  - CHỈ áp cho danh mục quyền thu-chi mới của pha này (không đụng quyền khác), theo whitelist trong bảng §6.4.
- **TEST CLASS "DB TIẾN HÓA" (bắt buộc, chống bug throwaway):** selftest H1 PHẢI có case chạy trên **DB đã có sẵn role MANAGER/ACCOUNTANT + user gán role đó TỪ TRƯỚC** (mô phỏng DB production đã tiến hóa), rồi chạy `seedIfEmpty` → assert MANAGER/ACCOUNTANT **có** các quyền thu-chi phù hợp và ADMIN đủ quyền. **KHÔNG** chỉ test trên DB throwaway trống (đó là lỗ hổng đã để lọt bug 9/7 — memory `feedback_verify_before_claim_and_db_upgrade_gap_9_7`). Thêm case đảo: quyền admin **đã cố ý gỡ** ở role cũ KHÔNG bị migration cấp lại (ngoài whitelist thu-chi).

---

## 7. KẾ HOẠCH BUILD THEO PHA (tuần tự, mỗi pha 1 gate)

| Pha | Nội dung | Bảng mới | Gate riêng |
|---|---|---|---|
| **H1** | Nền: schema + `CashCategory` (**+cột `affectsPnl`, H2/H3**) + `Fund` (**prefix `QU`, H6**) + phân quyền + seed danh mục hệ thống (gán affectsPnl) + **migration quyền một-lần idempotent cho MANAGER/ACCOUNTANT cũ (H7)** | CashCategory, Fund, AppliedMigration | typecheck0/build0 · vitest · selftest: CRUD danh mục, chặn xóa danh mục đang dùng, tạo quỹ (mã QU## không throw), **affectsPnl chặn danh mục nội bộ (I#12)**, **test class "DB tiến hóa" (I#14, H7)** |
| **H2** | Phiếu thu/chi (`CashEntry`) + số dư quỹ running + thu công nợ nối `Transaction` (**net-of-settlement H4** + **vô hiệu toggle settled thủ công H5**) + báo cáo lọc ngày (cơ bản) + KpiCard lợi nhuận MVP (**accrual §5**) | CashEntry, CashDebtSettlement | selftest: quỹ cân (I#1), thu công nợ ≤ nợ còn lại NET (I#2), người chi bắt buộc (I#3), tiền>0 không tràn (I#4), ngày local (I#10), chuyển quỹ không double-count, **lợi nhuận không double-count (I#13)**, **fundId display-only (I#15)** |
| **H2b** | Phân loại chất lượng công nợ (Transaction.debtQuality + log) + DebtPage StatBar/lọc 3 mức | DebtQualityLog (+cột Transaction) | selftest: đổi mức ghi log+audit, chặn đổi GD **đã thu đủ (net, KHÔNG dùng cờ settled)**, tổng theo mức khớp |
| **H3** | Tạm ứng + hoàn ứng + bộ đếm tháng | Advance | selftest: bộ đếm tháng đúng (I#7), hoàn ứng ≤ tạm ứng, sinh CashEntry liên kết, fundId display-only (I#15) |
| **H4** | Cọc máy + hoàn cọc + xác nhận thu hồi (nối AssetEvent) + thống kê mục I. **M5: nếu Q6 chốt cần thu hồi/thu công nợ từng MÁY riêng → mở rộng khóa serial/multi-quantity ở pha này (chờ Mr.Long chốt Q6).** | DeviceDeposit, DepositRefund | selftest: hoàn cọc ≤ đã cọc (I#5), chặn hoàn khi máy chưa về (I#6), thống kê đã/chưa/hoàn cọc |
| **H5** | Chi lương + trạng thái đã/chưa chi | SalaryPayment | selftest: **1 dòng SỐNG/NV/tháng — enforce service, xóa mềm rồi tạo lại OK (I#8, M4)**, PAID sinh CashEntry (affectsPnl=true), quỹ giảm đúng |
| **H6** | Báo cáo thu-chi đầy đủ + đối soát quỹ + Dashboard Lợi nhuận theo tháng (**accrual**) + công nợ theo chất lượng | — | selftest: đối soát quỹ tổng khớp, **profit tháng = Σ revenueAccrual − Σ CHI affectsPnl** (không double-count I#13), so tháng trước |

Mỗi pha theo **R_PROCESS_FEATURE_GATE**: build UI → CMD_AUDIT mở app screenshot/click → commit → pha kế. **Freeze + git tag** trước sang pha sau (WORKFLOW TỐI THƯỢNG). Không Build→Build→Build.

---

## 8. RỦI RO / PHẢN BIỆN (≥5 điểm dễ sai + cách chặn)

| # | Rủi ro | Hậu quả | Cách chặn |
|---|---|---|---|
| R1 | **Đếm trùng doanh thu** (cộng cả CashEntry thu công nợ lẫn Transaction.revenueAmount) | Lợi nhuận/doanh thu phồng gấp đôi | Lợi nhuận **ACCRUAL (§0 Q-A)**: THU = Σ Transaction.revenueAmount (theo txnDate) + Σ CashEntry THU **affectsPnl=true** (bán trực tiếp); **category DEBT_\* buộc affectsPnl=false** nên thu công nợ KHÔNG cộng vào lợi nhuận (đã có trong Transaction); thu công nợ chỉ ghi `CashDebtSettlement` (net-of-settlement, R4/H4); loại DEPOSIT/ADVANCE-clear/FUND_TRANSFER khỏi vế THU; invariant I#12/I#13 + selftest |
| R2 | **Cọc âm / hoàn cọc vượt** | Quỹ sai, cọc âm | Invariant I#5 `Σ refund ≤ deposit.amount`; conditional updateMany; amount>0 |
| R3 | **Sai đơn vị tiền (×1000)** | Toàn bộ tổng lệch 1000 lần so Transaction | §1: CashEntry.amount = **VND nguyên** như Transaction; selftest so tổng CashEntry với money hiển thị; **đính chính brief** |
| R4 | **Xóa mềm danh mục đang dùng** | Phiếu mồ côi, báo cáo lỗi | `remove` chặn nếu có CashEntry tham chiếu (`IN_USE`); chỉ cho `active=false`; join theo id vẫn hiển thị được |
| R5 | **Tiền âm / thập phân / tràn** | Crash / sai tổng | `parseAmount` integer>0, trần an toàn; type Int |
| R6 | **Đối soát quỹ lệch** (đọc số dư cứng bị drift) | Số dư sai theo thời gian | KHÔNG lưu số dư cứng — luôn tính running từ CashEntry POSTED (I#1) |
| R7 | **Race sinh mã phiếu / duyệt 2 lần** | Trùng mã, hủy đôi | `nextCode` trong `$transaction` cùng create; conditional transition (mẫu approval-service) |
| R8 | **Hoàn cọc khi máy chưa thu hồi** | Mất tiền + mất máy | I#6 bắt buộc `deviceRecovered` + AssetEvent hợp lệ mới POST |
| R9 | **Ngày lệch kỳ (UTC vs local)** | Phiếu nhảy tháng, lợi nhuận sai kỳ | Quy ước local B16; lọc `from 00:00 / to 23:59:59` local |
| R10 | **BAD phồng lợi nhuận accrual** (doanh thu BAD đã ghi nhận nhưng không thu được) | Lợi nhuận cao ảo, sai quyết định | §0 Q-C: BAD chỉ CỜ ĐỎ, KHÔNG tự ghi giảm; Dashboard **cảnh báo rõ "accrual đã gồm nợ BAD chưa trích lập"** (M1); ghi giảm chỉ khi Mr.Long chốt (Q4) qua danh mục CHI "Chi phí nợ xấu" affectsPnl=true |
| R11 | **Quyền mới không gán role cũ** (bug 9/7) | ADMIN kẹt quyền, menu ẩn | Migrate seed cấp quyền thu-chi cho role phù hợp + test "DB tiến hóa" |

---

## 9. CÂU HỎI CẦN Mr.Long CHỐT

1. **Duyệt phiếu chi?** Phiếu chi (đặc biệt trên 1 ngưỡng, vd ≥ X đ) có cần **duyệt như hủy bill** không (tái dùng ApprovalRequest), hay ghi thẳng POSTED + hủy mới cần duyệt? (Đề xuất: ghi thẳng; hủy cần duyệt + mật khẩu như xóa GD.)
2. **Đối soát ngân hàng:** có tích hợp thẳng dữ liệu bill/sao kê từ `globeway-quanlytaikhoan` (draft→post) ngay pha này, hay để pha sau chỉ nhập tay/ import Excel?
3. **Whitelist `affectsPnl` (thay câu cũ — lợi nhuận ĐÃ chốt ACCRUAL §0 Q-A):** danh mục nào tính vào lợi nhuận? **Đề xuất khóa:** vế CHI affectsPnl=true = chi phí vận hành + **chi lương (SALARY)**; affectsPnl=false = DEPOSIT_REFUND / ADVANCE / FUND_TRANSFER / DEVICE_DEPOSIT. Vế THU affectsPnl=true = SALE_POS/SALE_TID/DT-trực-tiếp-khác; affectsPnl=false = DEBT_* / DEPOSIT / hoàn ứng / FUND_TRANSFER. **Cần Mr.Long xác nhận đúng chưa** (đặc biệt: chi lương có tính chi phí không, có danh mục CHI nào là đầu tư/không-phí không).
4. **Nợ "không có khả năng thu hồi" (BAD):** §0 Q-C đã khóa = **chỉ cờ đỏ, KHÔNG tự ghi giảm**. Câu còn lại: khi muốn ghi giảm (sau) → dùng **danh mục CHI "Chi phí nợ xấu" affectsPnl=true** (đề xuất, khớp mô hình accrual §5.2) hay bút toán ghi giảm doanh thu accrual?
5. **Phân loại công nợ gắn mức nào:** từng khoản `Transaction` (đề xuất) hay cả khách? Có cần default-per-customer không?
6. **Thống kê "số máy chưa cọc" (mục I):** mẫu số là máy đang triển khai ở KH/đại lý (`PosDevice.status=DEPLOYED`) hay toàn bộ máy đã bán/giao? Định nghĩa "chưa cọc" chuẩn?
7. **Người nhận hoàn cọc / người nhận tạm ứng** là **User nội bộ** hay có thể là khách/đại lý (text tự do)? (Ảnh hưởng kiểu trường receiver.)
8. **Prefix mã** PT/PC/TU/CM/HC/CL/**QU** có đúng ý Mr.Long không? (Quỹ đổi `Q`→`QU` vì `CODE_PREFIX_REGEX=/^[A-Z]{2,4}$/` chặn prefix 1 ký tự — xem H6.)

---

## 10. TÓM TẮT
- **Mô hình chính:** `CashEntry` (phiếu thu/chi = chứng từ nguyên thủy) là trục; `Fund` (prefix **`QU`**) cân bằng bằng running-balance; `Advance`/`DeviceDeposit`/`DepositRefund`/`SalaryPayment` là chứng từ nghiệp vụ **sinh CashEntry liên kết** (không đếm trùng; fundId trên chúng = display-only); công nợ **nối `Transaction` sẵn có** qua `CashDebtSettlement` (**net-of-settlement**, KHÔNG dùng cờ `settled` làm nguồn); phân loại chất lượng công nợ ở `Transaction.debtQuality` + `DebtQualityLog`; **Lợi nhuận Dashboard = ACCRUAL (§0 Q-A): Σ Transaction.revenueAmount + Σ CashEntry affectsPnl(THU) − Σ CashEntry affectsPnl(CHI)** — cột `affectsPnl` chống double-count + chống lẫn dòng tiền nội bộ.
- **7 pha** (H1→H6, có H2b), mỗi pha 1 gate + selftest nghiệp vụ, tuần tự freeze/tag.
- **Rủi ro top:** đếm trùng doanh thu (R1, chặn bằng accrual + affectsPnl + net-of-settlement), sai đơn vị ×1000 (R3, đã đính chính brief), đối soát quỹ drift (R6), hoàn cọc khi máy chưa về (R8), BAD phồng lợi nhuận accrual (R10/M1), quyền mới không gán role cũ (R11/H7).

---

## 11. ĐÃ VÁ THEO QA PHẢN BIỆN (H1–H7, M1–M6) — 10/7

> 5 quyết định §0 (Q-A accrual · Q-B phiếu chi không duyệt · Q-C nợ BAD cờ đỏ · Q-E mã badge · Q-D admin re-auth) **GIỮ NGUYÊN, không đụng.** Dưới đây là các mục vá phát hiện QA.

| Mã | Vấn đề | Chỗ sửa trong spec |
|---|---|---|
| **H1** | Mâu thuẫn nội bộ Lợi nhuận (§5/§8R1/§9Q3 đề xuất cash-basis, trái §0 Q-A accrual) | Viết lại **§5** (accrual, HYBRID, 5.1/5.2) · **§5b** M1 · **§8 R1**+**R10** · **§9 Q3/Q4** (Q3 cũ "cash vs accrual" GỠ, thay bằng whitelist affectsPnl) · **§10** tóm tắt |
| **H2** | Vế CHI gồm cả hoàn cọc/tạm ứng/chuyển quỹ (không phải chi phí) | Thêm cột **`CashCategory.affectsPnl`** (§2.1) · CHI lợi nhuận chỉ affectsPnl=true, loại DEPOSIT_REFUND/ADVANCE/FUND_TRANSFER/DEVICE_DEPOSIT (§5.2) · invariant **I#12** + selftest |
| **H3** | Vế THU thiếu bán máy trực tiếp | THU = Σ Transaction.revenueAmount + Σ CashEntry THU affectsPnl (§5.1); loại DEBT_*/DEPOSIT/ADVANCE-clear/FUND_TRANSFER; affectsPnl áp cả THU (§2.1) · invariant **I#13** |
| **H4** | Thu trùng công nợ (dựa cờ `settled` boolean, sai khi thu từng phần) | Viết lại **`debtSummary` net-of-settlement từng side** (§2.4 + §3 + §6.1) · `settled` chỉ là hệ quả · invariant **I#2** |
| **H5** | 2 cơ chế tất toán (toggle tay + phiếu thu) | **Vô hiệu `settleTransactions` thủ công** (§2.4 + §3 + §6.1 dòng riêng) · `settled` chỉ đổi qua phiếu thu · invariant **I#9** |
| **H6** | Crash mã quỹ (`Q` 1 ký tự vi phạm `CODE_PREFIX_REGEX=/^[A-Z]{2,4}$/`) | Đổi **`Q`→`QU`** (§1 Sinh mã + §2.2 Fund.code + §9 Q8 + §10) |
| **H7** | Thiếu quyền role cũ (lặp bug 9/7 — `seedIfEmpty` chỉ gán role freshly-created) | **Migration một-lần idempotent** cấp quyền thu-chi cho MANAGER/ACCOUNTANT cũ, TÁCH khỏi nhánh freshly-created + cờ `AppliedMigration` (§6.4) · **test class "DB tiến hóa"** (§6.4 + invariant **I#14** + gate H1) |
| **M1** | Lợi nhuận là HYBRID + BAD phồng accrual | Ghi rõ HYBRID (§5) + cảnh báo "accrual đã gồm nợ BAD chưa trích lập" (§5b + R10); để ngỏ "Chi phí nợ xấu" affectsPnl=true |
| **M2** | `fundId` trên Advance/DeviceDeposit/SalaryPayment đếm trùng số dư | Chú thích **DISPLAY-ONLY** cả 3 model (§2.5/2.6/2.7) · invariant **I#15** cấm đếm trùng |
| **M3** | Hủy CashEntry không revert chứng từ gốc | **Chốt hướng:** hủy phiếu revert trong cùng `$transaction` (createDebtReceipt hủy → xóa/đảo CashDebtSettlement + tính lại settled; SALARY→UNPAID; refund→revert refundedAmount) — §6.1 cash-entry-service |
| **M4** | `SalaryPayment @@unique([userId,period])` + deletedAt = trái B05 | **BỎ @@unique DB**, enforce "1 dòng sống/NV/tháng" ở service (mẫu FeeRate) + partial index tùy chọn (§2.7) · invariant **I#8** |
| **M5** | Phụ thuộc Q6 (mẫu số máy / thu hồi từng phần) | Ghi rõ cần multi-quantity/serial cho thu hồi từng máy → mở rộng ở H4 khi Mr.Long chốt Q6 (§2.4 + §7 H4) |
| **M6** | DateTime mới thiếu `@db.Timestamptz(3)` + `@map` | Directive BẮT BUỘC (§1 Ngày) + vá các cột ngày đã nêu tên (entryDate/cancelledAt/advanceDate/depositDate/refundDate/paidAt/payDate + audit-cols) |

### Cần Mr.Long xác nhận (không tự quyết):
1. **Whitelist `affectsPnl`** (§9 Q3): đặc biệt **chi lương (SALARY) có tính là chi phí trừ lợi nhuận không**, và có danh mục CHI nào là đầu tư/không-phải-chi-phí cần affectsPnl=false không. (Spec đang đề xuất SALARY=chi phí.)
2. **Q6 mẫu số "số máy chưa cọc" + thu hồi từng máy** (§9 Q6, M5) — ảnh hưởng có cần serial-level ở H4 không.
3. **Q4 xử lý nợ BAD** khi muốn ghi giảm (danh mục "Chi phí nợ xấu" affectsPnl=true vs ghi giảm accrual) — chưa làm, để ngỏ.

### Sẵn sàng build H1 chưa?
**RỒI cho H1** (schema `CashCategory`+`affectsPnl`, `Fund` prefix `QU`, phân quyền + migration H7, seed danh mục). H1 KHÔNG phụ thuộc câu chờ Mr.Long: whitelist affectsPnl chỉ là **giá trị seed mặc định** (đề xuất §9 Q3) — có thể chỉnh sau qua UI cấu hình danh mục; nếu Mr.Long muốn chốt whitelist trước seed thì hỏi ở đầu H1. Các câu Q4/Q6 chỉ chạm H2b/H4 (pha sau), KHÔNG chặn H1.
