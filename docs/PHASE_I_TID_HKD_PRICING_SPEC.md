# PHASE I — TID · HKD · Ngành nghề · Giá · MST · Custody · Doanh số — SPEC THỐNG NHẤT

> **Vai trò tác giả:** KIẾN TRÚC SƯ (design-only). **Chưa** áp schema, **chưa** viết feature code. Đây là 1 spec thống nhất cho toàn domain để tránh nhiều migration đè nhau. Grounded 100% trên code thật (đọc `schema.prisma`, `transaction-service`, `fee-config-service`, `tid-service`, `tid-config-service`, `dashboard-service`, `business-rules/transaction.rules`, `permissions.ts`, `Dashboard.tsx MENU`, `TidConfigPage`, `RevenuePage`, `StatBar`, `StatusPill`, `Selection`, tool `mst-lookup`).
>
> **Governance:** R_SUPREME R7 (Read→Diff→Proposal→Approval→Backup→Patch→Regression→Production). Spec = bước Proposal. **CẤM build tới khi Mr.Long chốt mục "CẦN MR.LONG CHỐT".** Bao trùm 4 việc: **#11** ngành nghề + giá theo ngành, **#12** trạng thái MST, **#13** xếp hạng doanh số TID + cảnh báo Dashboard, **#14** TID custody.

---

## 0. PHÁT HIỆN TỪ CODE THẬT (chân lý nền — đọc trước khi thiết kế)

| # | Sự thật trong code | Hệ quả thiết kế |
|---|---|---|
| F1 | `Tid.hkdName` = **String? (TEXT tự do)**, KHÔNG phải FK tới `Dossier`. TID cấu hình qua `createConfigTid` chỉ lưu chuỗi tên HKD. | Muốn combobox chọn HKD có thật (§4 logic) phải **thêm `dossierId` FK** vào `Tid`. `hkdName` giữ làm cache hiển thị / dữ liệu cũ. |
| F2 | `Tid` đã có `customerId`, `deliveredAt`, `closedAt`, `agentId`. Custody hiện = 1 con trỏ hiện tại, **không có lịch sử kỳ giao–thu**. | #14 custody: hoặc chỉ thêm 1 kỳ hiện tại (đủ dùng) hoặc thêm bảng `TidCustody` lịch sử. Đã có `AssetEvent` (event log) + `PosTidBinding` (bind POS↔TID theo kỳ) để nối. |
| F3 | `FeeRate` key thực tế = `(partnerId, cardTypeId, effectiveFrom-ngày)`; **KHÔNG có industryId**. `CardType.bankId` gắn thẻ vào 1 bank. Không `@@unique` DB (bài học B05), "1 kỳ/1 mốc" enforce ở service. | #11: thêm chiều `industryId` vào `FeeRate` + đổi logic upsert/pick. Đây là thay đổi rủi ro cao nhất (đụng snapshot doanh thu). |
| F4 | `Transaction` **đã snapshot** `partnerMarginMilli` + `sellMarginMilli` lúc create (`resolveFeeForTxn`→`computeRevenue`). Đổi biểu phí sau KHÔNG đổi doanh thu đã ghi. | Thêm industry KHÔNG phá snapshot GD cũ — vì margin đã đóng băng. Chỉ ảnh hưởng GD **tạo mới sau** khi bật industry. Đây là điểm an toàn quan trọng. |
| F5 | `resolveFeeForTxn(db, tidRow, cardTypeId, at)` lookup `feeRate.findMany({partnerId, cardTypeId})` → `pickEffectiveRate(rows, at)`. `pickEffectiveRate` thuần (business-rules), chọn `effectiveFrom ≤ at` lớn nhất. | Thêm industry = thêm filter `industryId` vào `findMany` + truyền `tid.industryId`. `pickEffectiveRate` KHÔNG đổi (vẫn chọn theo kỳ trong tập đã lọc). |
| F6 | `Dossier` có `taxCode` (MST/ĐKKD), **KHÔNG có `mstStatus`**. `DossierPage` hiện dùng `FilterBar`, **CHƯA** dùng `StatusPill`/`StatBar`. | #12: thêm `mstStatus` (+`mstClosedAt`, `mstCheckedAt`) vào `Dossier`; thêm `StatusPill`+`StatBar`+lọc vào `DossierPage`. |
| F7 | **CHƯA có bảng `Industry`**, chưa có API `revenueByTid`, chưa có custody-history, chưa có combobox searchable. `Selection.tsx` chỉ là checkbox chọn dòng. | Combobox tìm-chọn = **component MỚI dùng chung** (`SearchSelect`). |
| F8 | `Dashboard.tsx getStats` chỉ đếm tổng + TID theo bank + POS theo status + 12 tháng. **Không** có thẻ doanh thu/cảnh báo. MENU là mảng tĩnh trong `Dashboard.tsx` (dòng 69-89). | #13 alert = thêm card vào Dashboard + service mới. Chèn menu "Cấu hình ngành nghề" vào MENU giữa `tidcfg` và `tid` (dòng 81-82). |
| F9 | `TidConfigPage` **đã có `FeePreview`** auto-show biểu phí theo `(partnerId, bankId)` kỳ hiện tại (dòng 258-287) qua `window.api.feeRateList`. | #11 auto-show = **mở rộng** FeePreview thêm chiều industry, KHÔNG làm mới từ đầu. |
| F10 | Phí lưu Int ×1000 (milli). `effectiveFrom` chuẩn hóa `startOfDayLocal` (B16). Mọi bảng: soft-delete `deletedAt` + `createdBy/updatedBy` + audit. Permission theo code (`hasPermission`), không theo tên role. | Bảng mới (`Industry`, M2M, custody) PHẢI theo đúng khuôn: soft-delete + audit trail + DUPLICATE_TRASH + P2002 guard + permission code mới. |
| F11 | `mst-lookup` = tool Node **riêng biệt** (Playwright + 2Captcha query `tracuunnt.gdt.gov.vn`), mỗi lookup giải captcha 3–120s, cần mạng, có API key. Không phải thư viện in-process. | #12 realtime MST = tích hợp **out-of-process, hàng đợi, offline-safe** (R2: gọi ngoài cần Mr.Long duyệt; G11 offline-safe). KHÔNG gọi đồng bộ trong IPC. |

---

## 1. MÔ HÌNH THỰC THỂ + QUAN HỆ (đích Phase I)

```
Dossier (HKD = gốc)
  ├─ 1..* Tid            (Tid.dossierId → Dossier.id)          [MỚI F1]
  ├─ *..*  Industry      (qua DossierIndustry)                 [MỚI: ngành HKD đã ĐKKD]
  └─ mstStatus ACTIVE|CLOSED (+mstClosedAt, mstCheckedAt)      [MỚI #12]

Industry (master ngành nghề: vận tải, tạp hóa, cà phê…)        [MỚI #11]
  ├─ *..*  Dossier       (qua DossierIndustry)
  └─ 1..*  FeeRate       (FeeRate.industryId → Industry.id)    [MỚI: +1 chiều giá]

Tid
  ├─ dossierId  → Dossier                                      [MỚI F1]
  ├─ industryId → Industry (∈ tập ngành của Dossier)           [MỚI #11]
  ├─ partnerId  → Partner   (đã có)
  ├─ bankId     → Bank      (đã có)
  ├─ customerId → Customer  (đã có — người ĐANG giữ)
  └─ 1..* TidCustody (kỳ giao–thu: từ→đến, KH)                 [MỚI #14 — nếu chọn phương án B]

FeeRate  key mới = (partnerId, cardTypeId, industryId, effectiveFrom-ngày)   [MỞ RỘNG F3]
  (cardType.bankId suy ra ngân hàng; bank KHÔNG lưu lại trong key)

Transaction (bất biến, snapshot margin)                        [KHÔNG đổi cột — F4]
  └─ tidId → Tid ; margin đóng băng ; industry suy từ tid tại thời điểm ghi

Chuỗi tự động (§4 logic Mr.Long):
  Industry ──► FeeRate(partner+cardType+industry) ──► Tid(dossier+partner+bank+industry)
        └──► FeePreview auto-show ──► Transaction TỰ tính doanh thu (snapshot)
```

**Quan hệ nối (không hard FK — theo F10, join ở service):** các bảng master (`Industry`, `DossierIndustry`, `TidCustody`) dùng scalar id-link + join service-layer, đồng bộ khuôn hiện có; **ngoại lệ**: `DossierIndustry` là junction thuần nên có thể `@@unique([dossierId, industryId])` (soft-delete-aware) — bàn ở §3.

---

## 2. SCHEMA PRISMA ĐỀ XUẤT (CHƯA ÁP — chỉ proposal)

> Tất cả field ×1000/soft-delete/audit theo khuôn F10. Bank **postgres**; `@db.Timestamptz(3)` cho mốc thời gian như bảng hiện có.

### 2.1 Bảng MỚI — Industry (#11)
```prisma
// Ngành nghề (master, IMS Phase I). Vận tải, tạp hóa, cà phê… Theo ĐKKD.
model Industry {
  id        Int       @id @default(autoincrement())
  code      String    @unique                 // NG01, NG02… (CodeCounter prefix 'NG')
  name      String
  note      String?
  createdBy Int?      @map("created_by")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedBy Int?      @map("updated_by")
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedBy Int?      @map("deleted_by")
  @@map("industries")
}
```

### 2.2 Bảng MỚI — DossierIndustry (M2M HKD↔ngành đã ĐKKD, #11)
```prisma
// HKD ↔ Ngành nghề (nhiều-nhiều): tập ngành 1 HKD đã đăng ký kinh doanh.
model DossierIndustry {
  id         Int       @id @default(autoincrement())
  dossierId  Int       @map("dossier_id")
  industryId Int       @map("industry_id")
  createdBy  Int?      @map("created_by")
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  deletedAt  DateTime? @map("deleted_at") @db.Timestamptz(3)   // hủy gán = soft-delete
  @@unique([dossierId, industryId])           // 1 cặp/1 lần (re-link = clear deletedAt, giống PartnerBank)
  @@index([dossierId])
  @@index([industryId])
  @@map("dossier_industries")
}
```

### 2.3 MỞ RỘNG — Tid (+dossierId, +industryId) (#11)
```prisma
model Tid {
  // … giữ nguyên toàn bộ field hiện có …
  dossierId  Int?  @map("dossier_id")   // MỚI: HKD chọn từ Hồ sơ HKD (combobox). hkdName giữ làm cache.
  industryId Int?  @map("industry_id")  // MỚI: ngành của TID (∈ ngành ĐKKD của dossierId)
  @@index([dossierId])
  @@index([industryId])
}
```
*Không xóa `hkdName`* — backfill-safe: dữ liệu cũ giữ tên, `dossierId` null cho tới khi map.

### 2.4 MỞ RỘNG — FeeRate (+industryId) (#11)
```prisma
model FeeRate {
  // … giữ nguyên: partnerId, cardTypeId, phiMua/phiCaiMay/phiBan, effectiveFrom, audit, soft-delete …
  industryId Int @map("industry_id")   // MỚI: chiều ngành. Backfill = ngành mặc định 'Khác' (§6 I2).
  @@index([partnerId])
  @@index([cardTypeId])
  @@index([industryId])
}
```
Key logic mới (enforce ở service, KHÔNG `@@unique` DB — bài học B05): **`(partnerId, cardTypeId, industryId, effectiveFrom-ngày)`**.

### 2.5 MỞ RỘNG — Dossier (+mstStatus) (#12)
```prisma
model Dossier {
  // … giữ nguyên …
  mstStatus  String    @default("ACTIVE") @map("mst_status")   // ACTIVE | CLOSED
  mstClosedAt DateTime? @map("mst_closed_at") @db.Timestamptz(3) // ngày đóng MST (nếu CLOSED)
  mstCheckedAt DateTime? @map("mst_checked_at") @db.Timestamptz(3) // lần cập nhật MST gần nhất (realtime opt-in)
  mstCheckNote String?  @map("mst_check_note")                  // kết quả text lần tra gần nhất
}
```

### 2.6 Bảng MỚI (phương án B) — TidCustody (#14, kỳ giao–thu)
```prisma
// Lịch sử KH giữ TID theo kỳ (giao → thu). Nối AssetEvent (TID_DELIVERED/TID_RECALLED).
model TidCustody {
  id          Int       @id @default(autoincrement())
  tidId       Int       @map("tid_id")
  customerId  Int       @map("customer_id")   // KH giữ trong kỳ
  fromDate    DateTime  @map("from_date") @db.Timestamptz(3)   // ngày GIAO
  toDate      DateTime? @map("to_date") @db.Timestamptz(3)     // ngày THU (null = đang giữ)
  note        String?
  createdBy   Int?      @map("created_by")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  @@index([tidId])
  @@index([customerId])
  @@map("tid_custodies")
}
```
> **Lưu ý #14:** nếu Mr.Long chỉ cần "KH đang giữ + 1 kỳ hiện tại" → **KHÔNG cần bảng này**, chỉ thêm `custodyFromDate/custodyToDate` vào `Tid` (phương án A, rẻ hơn). Xem "CẦN MR.LONG CHỐT".

### 2.7 CodeCounter
Thêm prefix `'NG'` (Industry). Không đổi bảng — `CodeCounter` đã generic (§D).

---

## 3. KEYING GIÁ — ĐỀ XUẤT & PHẢN BIỆN (điểm chốt #11)

**Đề xuất key FeeRate:** `(partnerId, cardTypeId, industryId, effectiveFrom-ngày)`.

- `cardTypeId` đã tự mang ngân hàng (`CardType.bankId`) → **bank suy từ cardType, KHÔNG lưu riêng trong key** (khớp code F3/F5: `resolveFeeForTxn` validate `card.bankId === tid.bankId`). Thêm `bankId` vào key = **thừa + nguy cơ lệch** (2 nguồn bank).
- `partnerId` **giữ bắt buộc** trong key: logic Mr.Long §3 nói giá theo "(đối tác + ngân hàng + ngành + loại thẻ)". Đối tác là chiều thật (biểu phí khác nhau theo đối tác — đã có).
- `industryId` **bắt buộc** (NOT NULL sau backfill 'Khác').

**Phản biện đã cân nhắc:**
1. *"Cho industry nullable để giá 'chung mọi ngành'?"* → BÁC. Nullable làm `pickEffectiveRate` phải xử 2 lớp (có ngành / rơi về null) → nhập nhằng + khó QA. Thay bằng **ngành 'Khác' (default)** làm fallback tường minh: TID chưa gán ngành → industry='Khác' → tra giá 'Khác'. Một đường dữ liệu.
2. *"Đưa bankId vào key cho chắc"?* → BÁC (thừa, xem trên). Nhưng **validate** vẫn giữ: cardType.bankId phải khớp tid.bankId (đã có), và bank phải liên kết partner (`PartnerBank`, đã có ở `setFeeRate`).
3. *Va chạm mốc:* upsert theo `(partner, cardType, industry, effectiveFrom-ngày)`; khác mốc → tạo kỳ mới (giữ P1.1). `pickEffectiveRate` KHÔNG đổi vì tập đã lọc thêm industry.

---

## 4. COMBOBOX TÌM-CHỌN DÙNG CHUNG (`SearchSelect`) — nền của #11

Component MỚI (F7 — chưa tồn tại). Hành vi chuẩn (§4 logic):
- Bấm mũi tên → **xổ full** danh sách (từ nguồn đã nạp).
- Gõ 1-2-3 ký tự → **lọc client-side** hiện gợi ý (accent-insensitive, khớp tên + mã).
- **KHÔNG cho nhập tay tự do** — value bắt buộc là id có thật; blur không khớp → clear.
- Dùng chung: HKD (Hồ sơ), đối tác, ngành nghề, loại thẻ, khách hàng… (đồng bộ UI, R_UI_STANDARD).
- **Performance (rủi ro R4):** danh sách HKD/khách có thể lớn → nạp qua API list nhẹ (chỉ `id,label,code`), lọc client; nếu > ~2000 dòng thì thêm chế độ **server-search** (debounce gọi `dossier:list?search=`). Ngưỡng chuyển server-search = cấu hình.
- Style: theo `Field.tsx inputCls` + Catppuccin/brand-tint hiện có; không tự chế màu.

---

## 5. KẾ HOẠCH MIGRATION THEO PHA (mỗi pha: gate + selftest + tag)

> Thứ tự tối ưu theo **rủi ro & phụ thuộc**, KHÔNG Build→Build→Build (WORKFLOW TỐI THƯỢNG). Mỗi pha: Build → Unit test → Regression (selftest cùng khuôn `selftest-*.ts` hiện có) → Production Validation Mr.Long → Freeze → Git tag → pha kế. Tier N+1 đóng băng tới khi Tier N tagged.

### PHA I0 — Nền dùng chung (tiền đề, không schema)
- Build `SearchSelect` component + `industry:list-lite` chưa cần (dùng khi I1 xong). Có thể gộp đầu I1.
- **Gate:** render thử combobox với data giả; selftest UI thủ công. *(I0 có thể merge vào I1 để tránh pha rỗng.)*

### PHA I1 — Industry master + M2M + trang "Cấu hình ngành nghề" (#11 phần 1)
- **Migration:** tạo `industries`, `dossier_industries`. Seed ngành **'Khác'** (code `NG00`/`NG01`) — nền cho backfill I2.
- **Service:** `industry-service.ts` (list/create/update/delete CRUD + DUPLICATE_TRASH + P2002 + audit) theo khuôn `fee-config-service`. `dossier-service`: thêm get/set ngành của 1 HKD (gán/bỏ M2M).
- **IPC:** `industry:list|create|update|delete`, `dossierIndustry:list|set`.
- **UI:** trang RIÊNG `IndustryConfigPage.tsx`; chèn MENU giữa `tidcfg` và `tid` (Dashboard.tsx dòng 81-82): thứ tự `Cấu hình TID → Cấu hình ngành nghề → Quản Lý TID`. Trong `DossierPage` form: multi-select ngành ĐKKD của HKD (dùng SearchSelect/checkbox list).
- **Quyền:** MỚI `CONFIG_INDUSTRY_VIEW` / `CONFIG_INDUSTRY_MANAGE` (thêm vào `PERMISSIONS` + `DEFAULT_ROLE_PERMISSIONS` cho ADMIN/MANAGER/ACCOUNTANT/WAREHOUSE). **Bug class "DB tiến hóa"** (memory 9/7): migration PHẢI gán quyền mới cho role cũ, không chỉ seed DB mới.
- **Gate/selftest:** `selftest-industry.ts` — CRUD, trùng tên (active/trash), gán/bỏ ngành HKD, không xóa ngành đang được HKD/FeeRate dùng (chặn hoặc cảnh báo). Tag `phase-I1`.

### PHA I2 — FeeRate +industry + form giá + auto-show + TID gắn HKD/ngành (#11 phần 2 — RỦI RO CAO NHẤT)
- **Migration (2 bước, backfill-safe):**
  1. `ALTER FeeRate ADD industry_id NULL`; `ALTER Tid ADD dossier_id NULL, industry_id NULL`.
  2. **Backfill:** mọi `FeeRate` cũ → `industry_id = id('Khác')`; mọi `Tid` cũ → `industry_id = id('Khác')`, `dossier_id` = match theo `hkdName` nếu duy nhất, else NULL (báo cáo danh sách cần map tay).
  3. `ALTER FeeRate ALTER industry_id SET NOT NULL` (chỉ sau backfill 0 null). `Tid.industry_id` giữ nullable→default 'Khác' ở service.
- **Service:**
  - `fee-config-service.setFeeRate/listFeeRates` +`industryId` (upsert key mới; filter list).
  - `transaction-service.resolveFeeForTxn`: `findMany({partnerId, cardTypeId, industryId: tid.industryId ?? id('Khác')})` → `pickEffectiveRate` (F5). **Snapshot GIỮ NGUYÊN (F4)** — GD cũ không đổi.
  - `tid-config-service.createConfigTid/updateConfigTid`: +`dossierId` (validate tồn tại + ACTIVE MST theo chốt #12), +`industryId` (validate ∈ ngành của dossier).
- **UI:**
  - `FeeConfigPage`: form set giá thêm chọn **ngành**.
  - `TidForm` (TidConfigPage): **combobox HKD** (SearchSelect từ Hồ sơ, thay input tên tay) → đối tác → bank → **ngành (lọc theo ngành ĐKKD của HKD)** → mở rộng `FeePreview` filter thêm industry → **auto-show** bảng giá loại thẻ đúng tổ hợp.
- **Quyền:** không mới (dùng `CONFIG_FEE_*`, `CONFIG_TID_*`).
- **Gate/selftest:** `selftest-revenue`/`gcfg` mở rộng: (a) GD cũ doanh thu **bất biến** trước/sau migration (so tổng); (b) GD mới tra đúng giá theo ngành; (c) ngành khác giá khác → margin khác; (d) TID chưa ngành → rơi 'Khác'; (e) dossierId sai/HKD đóng MST → chặn theo chốt. Tag `phase-I2`.

### PHA I3 — Dossier MST status + UI (#12)
- **Migration:** `ALTER Dossier ADD mst_status DEFAULT 'ACTIVE', mst_closed_at, mst_checked_at, mst_check_note`. Backfill `ACTIVE`.
- **Service:** `dossier-service`: set MST status (thủ công) + filter theo mstStatus. Endpoint **tùy chọn** realtime (xem §7).
- **UI:** `DossierPage` thêm `StatusPill` (map ACTIVE/CLOSED — mở rộng `StatusPill.MAP`) + `StatBar` (đếm ACTIVE/CLOSED) + filter. Nút "Đóng MST" (+ngày).
- **Quyền:** dùng `CONFIG_DOSSIER_MANAGE`. Realtime opt-in cần quyền riêng `DOSSIER_MST_SYNC` (R2 gọi ngoài).
- **Ràng buộc chốt:** HKD `CLOSED` có **chặn gán TID mới** không (I2 dùng kết quả này). Xem "CẦN MR.LONG CHỐT".
- **Gate/selftest:** `selftest-dossier-mst.ts` — set CLOSED/ACTIVE, filter, (nếu chốt chặn) create TID với dossier CLOSED → FORBIDDEN. Tag `phase-I3`.

### PHA I4 — TID custody (#14)
- **Migration:** phương án A (`Tid.custodyFromDate/toDate`) **hoặc** B (bảng `tid_custodies`) theo chốt. Backfill: TID đang ACTIVE có `customerId` → mở 1 kỳ `fromDate = deliveredAt ?? openedAt`, `toDate = null`.
- **Service:** mở/đóng kỳ custody nối vào `assignTid`/`markTidDelivered`/`recallTid`/`replaceTid` (tid-service) — mỗi lần giao ghi kỳ mới, mỗi lần thu đóng kỳ. Ghi kèm `AssetEvent` (đã có).
- **UI:** cột "KH đang giữ" + "kỳ giao" ở `TidPage`; (B) tab lịch sử custody.
- **Quyền:** `TID_VIEW`/`TID_MANAGE` (đã có).
- **Gate/selftest:** `selftest-tid-custody.ts` — giao→thu→giao lại tạo đúng số kỳ, không chồng kỳ (rủi ro R7). Tag `phase-I4`.

### PHA I5 — Xếp hạng doanh số TID + cảnh báo Dashboard (#13)
- **Migration:** không (đọc từ `Transaction`). Có thể thêm `AppSetting` ngưỡng.
- **Service:** `transaction-service.revenueByTid(filter)` — group `Transaction` theo `tidId` (loại CANCELLED như `listTransactions` F, **giữ B11**: tính cả TID xóa mềm — không lọc `tid.deletedAt`, join nhãn service-layer). `dashboard-service`: cards cảnh báo.
- **UI:** `RevenuePage` bảng xếp hạng cao→thấp + cờ hoạt động; `Dashboard` thẻ cảnh báo (không hoạt động / không doanh số / doanh số thấp[ngưỡng] / tốt) + **nối tắt** bấm→lọc RevenuePage.
- **Quyền:** `REVENUE_VIEW`/`DASHBOARD_VIEW` (đã có).
- **Gate/selftest:** `selftest-revenue` mở rộng — ranking đúng thứ tự, GD của TID đã xóa mềm vẫn vào tổng (B11), ngưỡng phân loại đúng biên. Tag `phase-I5`.

> **Độc lập & re-order:** I3/I4/I5 KHÔNG phụ thuộc chuỗi pricing → có thể chạy song song/đổi thứ tự sau I1. **I2 bắt buộc sau I1** (cần Industry để backfill). Đề xuất giữ thứ tự trên vì I1→I2 là rủi ro-cao nên làm & đóng băng trước; nhưng nếu Mr.Long muốn giá trị sớm, I5 (ranking, 0 migration) có thể chen ngay sau I1.

---

## 6. TÓM TẮT SERVICE / IPC / UI / QUYỀN MỖI PHA

| Pha | Bảng | Service mới/sửa | IPC mới | UI | Quyền mới |
|-----|------|-----------------|---------|----|-----------|
| I1 | +industries, +dossier_industries | industry-service; dossier-service(ngành) | industry:*, dossierIndustry:* | IndustryConfigPage; DossierPage(ngành); MENU | CONFIG_INDUSTRY_VIEW/MANAGE |
| I2 | FeeRate+industryId; Tid+dossierId+industryId | fee-config, transaction(resolveFee), tid-config | feeRate:set/list (+industry) | FeeConfigPage; TidForm+SearchSelect+FeePreview | — |
| I3 | Dossier+mstStatus | dossier-service(MST) | dossier:setMst, dossier:mstSync(opt) | DossierPage(StatusPill/StatBar/filter) | DOSSIER_MST_SYNC (opt) |
| I4 | +tid_custodies (hoặc Tid cols) | tid-service(custody) | tid:custodyList | TidPage custody | — |
| I5 | — (AppSetting ngưỡng) | transaction(revenueByTid), dashboard(alerts) | transaction:revenueByTid, dashboard:alerts | RevenuePage ranking; Dashboard cards | — |

---

## 7. TÍCH HỢP mst-lookup (realtime MST — #12, tùy chọn, offline-safe)

`mst-lookup` là tool ngoài (Playwright + 2Captcha, F11). **KHÔNG** gọi đồng bộ trong IPC (block UI 3–120s, có thể fail mạng/captcha).

**Kiến trúc đề xuất (out-of-process, opt-in, R2 duyệt):**
1. Mặc định **TẮT**. Bật ở Cài đặt (quyền `DOSSIER_MST_SYNC`) — R2: mọi gọi ra ngoài cần Mr.Long duyệt bật.
2. Người dùng bấm "Tra MST" trên 1 HKD → main **spawn tiến trình** tool (hoặc gọi HTTP nếu tool chạy `express` sẵn — package có express) với `taxCode`, **timeout + hàng đợi tuần tự** (tránh spam captcha/tốn phí 2Captcha).
3. Kết quả → cập nhật `mstStatus/mstCheckedAt/mstCheckNote`; **lỗi mạng/captcha/timeout = KHÔNG đổi status**, chỉ set `mstCheckNote='Không tra được (offline/timeout)'` + toast. Trạng thái cũ giữ nguyên (G11 offline-safe).
4. **KHÔNG** auto-sync toàn bộ HKD định kỳ trong bản đầu (tốn phí + rủi ro rate-limit). Chỉ thủ công từng HKD; batch để pha sau nếu Mr.Long muốn.
5. API key 2Captcha đang hardcode trong tool → chuyển ra `AppSetting`/env khi wire (không nhúng vào app repo).

---

## 8. ĐỊNH NGHĨA "HOẠT ĐỘNG" (#13 — cần chốt, đề xuất)

Hai chiều khác nhau, phải tách rõ (tránh nhập nhằng):
- **Vòng đời (status TID):** ACTIVE = đang vận hành (đã có, `Tid.status`).
- **Có doanh số (hoạt động kinh doanh):** có ≥1 GD `POSTED` trong **kỳ đang xét** (mặc định 30 ngày, cấu hình).

**Đề xuất phân loại cảnh báo Dashboard (ngưỡng cấu hình qua AppSetting):**
| Nhóm | Điều kiện |
|------|-----------|
| Không hoạt động | `status ≠ ACTIVE` (DEAD/CLOSED/RECALLED/UNASSIGNED) |
| Không doanh số | status ACTIVE nhưng **0 GD** trong kỳ |
| Doanh số thấp | ACTIVE + doanh thu kỳ **< ngưỡng thấp** (cấu hình, vd 1.000.000đ) |
| Tốt | ACTIVE + doanh thu kỳ **≥ ngưỡng tốt** |

Ngưỡng thấp/tốt/kỳ = **CẦN MR.LONG CHỐT**.

---

## 9. RỦI RO / PHẢN BIỆN (≥8)

1. **Double-count doanh thu:** `revenueByTid` (#13) nếu vô ý cộng cả bill `CANCELLED` hoặc cộng lại margin thay vì `revenueAmount` snapshot → lệch tổng. → Bắt buộc dùng cột `revenueAmount` đã snapshot + `status ≠ CANCELLED` (khớp `listTransactions` F). Selftest so tổng `revenueByTid` == `listTransactions.summary.totalRevenue`.
2. **Phá snapshot khi thêm chiều industry (#11):** nếu ai đó "tính lại" doanh thu GD cũ theo giá-có-ngành → sai lịch sử. → Snapshot GD **bất biến** (F4); industry chỉ ảnh hưởng GD tạo mới. Selftest I2 (a) khóa điểm này.
3. **Backfill FeeRate/TID/GD cũ (#11):** `FeeRate` cũ chưa có industry; set NOT NULL trước backfill = migration fail. → 2 bước: add NULL → backfill 'Khác' → set NOT NULL. GD cũ **không** cần industry (đã snapshot). TID cũ `dossierId` match theo `hkdName` có thể **nhập nhằng/trùng** → chỉ auto-map khi duy nhất, còn lại xuất danh sách map tay.
4. **Combobox performance (#11):** HKD/khách lớn → nạp full client lag. → list-lite (id,label,code) + ngưỡng chuyển server-search (§4). Selftest với vài nghìn dòng giả.
5. **Gọi mst-lookup lỗi mạng/captcha/phí (#12):** block UI, tốn tiền 2Captcha, rate-limit gdt.gov.vn. → out-of-process + hàng đợi tuần tự + timeout + offline-safe giữ status cũ + opt-in R2 (§7). Không auto-batch bản đầu.
6. **Ngưỡng "doanh số thấp" (#13):** hardcode = sai ngữ cảnh ngành/kỳ. → AppSetting cấu hình + kỳ cấu hình; mặc định tạm chờ Mr.Long chốt. TID mới tạo trong kỳ dễ bị gắn cờ "thấp" oan → loại TID có `createdAt`/`deliveredAt` trong kỳ khỏi cảnh báo (grace).
7. **Custody chồng kỳ (#14):** giao lại khi kỳ cũ chưa `toDate` → 2 kỳ open cùng lúc. → Quy tắc: mở kỳ mới phải đóng kỳ open trước (set toDate = ngày giao mới). Selftest chặn 2 kỳ open. Nối đúng `assign/replace/recall/markDelivered`.
8. **"DB tiến hóa" — quyền mới không gán role cũ (#11 I1):** thêm `CONFIG_INDUSTRY_*` chỉ seed DB mới → DB production cũ ADMIN không thấy menu (precedent memory 9/7). → Migration data-step gán quyền mới cho role hiện có; selftest chạy trên DB đã có dữ liệu, KHÔNG chỉ throwaway.
9. **Bank 2 nguồn (#11):** bank suy từ cardType vs `Tid.bankId` — nếu key giá thêm bankId sẽ lệch. → Không đưa bankId vào key; giữ validate `card.bankId === tid.bankId` (đã có). (Chốt §3-#2.)
10. **Ngành TID ∉ ngành ĐKKD của HKD:** chọn ngành ngoài tập HKD → sai logic §1. → Validate service `industryId ∈ DossierIndustry(dossierId)`; UI lọc dropdown ngành theo HKD đã chọn.
11. **HKD đóng MST vẫn gán TID (#12↔#11):** nếu chốt "chặn" mà I2 build trước I3 → thiếu ràng buộc. → Thứ tự/chốt: quyết định #12-chặn trước khi freeze I2, hoặc thêm ràng buộc ở I3 patch lại I2 (regression).
12. **`FeePreview` sai kỳ khi thêm industry:** hiện lọc `isCurrent` theo (partner,bank); thêm industry mà quên → hiện giá ngành khác. → Mở rộng filter industry + selftest auto-show đúng tổ hợp.

---

## 10. CẦN MR.LONG CHỐT (không đoán — R10 uncertainty→STOP)

1. **Key giá chính xác:** xác nhận `(đối tác + loại thẻ + ngành + kỳ)`, **bank suy từ loại thẻ** (không chọn riêng)? Đối tác **bắt buộc** trong key? *(Đề xuất: đúng như vậy — §3.)*
2. **Ngành mặc định:** dùng ngành **'Khác'** làm fallback cho TID/giá chưa gán ngành (thay vì nullable)? *(Đề xuất: có.)*
3. **HKD đóng MST (CLOSED) có CHẶN gán TID mới không?** (chặn cứng / cảnh báo cho qua / không liên quan). Ảnh hưởng ràng buộc I2.
4. **Định nghĩa "hoạt động" (#13):** theo **status TID** hay **có GD trong kỳ**? Kỳ mặc định bao nhiêu ngày (30?).
5. **Ngưỡng doanh số:** "thấp" = ? đ, "tốt" = ? đ (theo TID/tháng). Có grace cho TID mới trong kỳ không?
6. **Custody (#14):** cần **lịch sử nhiều kỳ giao–thu** (bảng `TidCustody`, phương án B) hay chỉ **1 kỳ hiện tại** (2 cột trên `Tid`, phương án A)?
7. **Realtime MST (#12):** có bật tích hợp `mst-lookup` ngay không (R2 cần Mr.Long duyệt gọi ra ngoài + chi phí 2Captcha), hay pha sau — bản đầu chỉ set status thủ công?
8. **Thứ tự pha:** giữ I1→I2→I3→I4→I5, hay chen I5 (ranking, 0 migration) ngay sau I1 để có giá trị sớm?

---

## 11. TRẠNG THÁI
DRAFT design — chờ Mr.Long duyệt mục §10. Sau duyệt: QA phản biện spec → build theo pha I1 (gate+tag) → … Không build tới khi §10 chốt.
</content>
</invoke>
