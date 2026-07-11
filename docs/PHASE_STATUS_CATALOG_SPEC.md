# PHASE R14 — Danh mục trạng thái tùy biến dùng chung (Status Catalog)

> Mr.Long chốt hướng **B** (11/7): làm trọn gói hệ trạng thái tùy biến trước, gộp **R13 (trạng thái đối tác)** vào, rồi mới đóng gói 1 exe (R8–R14).

## 1. Vấn đề
Mọi bảng có cột trạng thái đang dùng **danh sách cứng** trong code (enum). Mr.Long: *"tất cả các trường có logic trạng thái cần có thêm mới trạng thái, vì có ngoại lệ ngoài trạng thái cố định"*. Precedent đã có: **Trạng thái TID cấu hình** (bảng `TidConfigStatus`) cho tự thêm — cần tổng quát hóa thành 1 cơ chế dùng chung (Bug Class Extension Principle: 1 cơ chế, không rải rác).

## 2. Nguyên tắc phân loại (ngoại lệ trạng thái cố định)
| Nhóm | Thực thể | Nhãn + màu đổi được | Thêm trạng thái mới |
|---|---|---|---|
| **Master-data** | Ngân hàng, Khách hàng, **Đối tác (mới)**, Tình trạng máy POS, MST hồ sơ HKD | ✅ | ✅ (builtin vẫn khóa xóa) |
| **State-machine (cố định)** | Vòng đời TID, Duyệt hủy bill, Phiếu thu/chi, Nhật ký | ✅ | ❌ (builtin-locked — thêm sẽ vỡ tự động hóa) |

- **Builtin** = trạng thái mặc định do hệ thống seed: **KHÔNG xóa được, KHÔNG đổi `code`** (chỉ đổi nhãn hiển thị + màu + thứ tự + ẩn/hiện khỏi dropdown).
- **Custom** = do người dùng thêm: xóa được **khi chưa có bản ghi nào dùng** (nếu đang dùng → chặn xóa, chỉ được ẩn).

## 3. Schema mới — `StatusOption`
```prisma
model StatusOption {
  id        Int       @id @default(autoincrement())
  entity    String    // BANK | CUSTOMER | PARTNER | POS_DEVICE | HKD_MST | TID_LIFECYCLE | ...
  code      String    // ACTIVE, INACTIVE, LOCKED, SIGNED, ... hoặc custom (CUSTOM_<n>)
  label     String    // "Đang hoạt động"
  tone      String    @default("slate") // emerald|amber|slate|rose|sky|indigo|violet|brand
  isBuiltin Boolean   @default(false) @map("is_builtin")
  allowAdd  Boolean   @default(false) @map("allow_add") // nhóm master-data = true (điều khiển UI cho phép thêm)
  sortOrder Int       @default(0) @map("sort_order")
  active    Boolean   @default(true) // ẩn/hiện trong dropdown (builtin luôn dùng được khi đã gán)
  createdBy Int?      @map("created_by")
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedBy Int?      @map("updated_by")
  updatedAt DateTime  @updatedAt @map("updated_at") @db.Timestamptz(3)
  deletedAt DateTime? @map("deleted_at") @db.Timestamptz(3)
  deletedBy Int?      @map("deleted_by")
  @@unique([entity, code])
  @@index([entity])
  @@map("status_options")
}
```
`allowAdd` lưu theo từng dòng để service/UI biết entity nào cho thêm (đơn giản: mọi dòng cùng entity cùng giá trị allowAdd; seed đặt sẵn). Có thể thay bằng bảng `entity → allowAdd` cứng trong code — chọn **cứng trong code** (`ENTITY_ALLOW_ADD` map) để tránh sai lệch dữ liệu; bỏ cột `allowAdd`. → **Quyết định: bỏ `allowAdd`, dùng map cứng trong service.**

### Seed builtin (trong migration SQL — idempotent)
- BANK: ACTIVE "Đang hoạt động" emerald(0) · INACTIVE "Không hoạt động" slate(1)
- CUSTOMER: ACTIVE "Đang hoạt động" emerald(0) · LOCKED "Đã khóa" amber(1) · CANCELLED "Đã hủy" slate(2)
- PARTNER: SIGNED "Đã ký hợp đồng hợp tác" emerald(0) · UNSIGNED "Chưa ký hợp đồng hợp tác" amber(1) · TERMINATED "Đã hủy hợp đồng hợp tác" rose(2)
- POS_DEVICE: IN_STOCK/DEPLOYED/IN_REPAIR/DAMAGED/RETIRED (nhãn VN sẵn có)
- HKD_MST: ACTIVE "Hoạt động" emerald · CLOSED "Đóng" slate

## 4. Thay đổi thực thể
- **Partner** (R13): thêm cột `status String @default("UNSIGNED")`. Migration: đối tác hiện có → default **UNSIGNED** (Chưa ký). *Ghi chú Mr.Long: nếu muốn set hết = Đã ký thì báo, chạy 1 UPDATE.*
- Các entity khác giữ nguyên cột `status` — chỉ đổi cách render (đọc nhãn/màu từ catalog thay vì hardcode).

## 5. Service `status-catalog-service.ts`
- `ENTITY_ALLOW_ADD: Record<string, boolean>` — master-data=true, state-machine=false.
- `listStatusOptions(entity)` → options active, sort theo sortOrder (dùng cho badge/filter/form).
- `listStatusOptionsAdmin(entity)` → gồm cả inactive (cho trang cấu hình).
- `createStatusOption({entity,label,tone})` → chặn nếu `!ENTITY_ALLOW_ADD[entity]`; auto-code `CUSTOM_<seq>` unique/entity; isBuiltin=false. Audit.
- `updateStatusOption(id,{label,tone,sortOrder,active})` → builtin: cho đổi label/tone/sortOrder, cho active=false? (builtin không được ẩn nếu đang là mặc định — cho phép ẩn nhưng cảnh báo). KHÔNG đổi code/entity. Audit.
- `deleteStatusOption(id)` → chỉ custom; chặn nếu có entity row dùng `code` (đếm) → thông báo "đang dùng, chỉ ẩn được". Soft-delete. Audit.
- Validation dùng ở create/update entity: `assertStatusValid(entity, code)` — code phải tồn tại (active hoặc đã gán).

## 6. IPC + preload
`statusOption:list` / `:listAdmin` / `:create` / `:update` / `:delete` → preload `statusOptionList/…`.

## 7. UI
- **Trang cấu hình:** tab **"Trạng thái"** trong hub *Cấu hình ngân hàng* (BankConfigPage) — dropdown chọn thực thể + bảng trạng thái (badge preview, thứ tự, builtin có khóa) + thêm/sửa/xóa (nút Thêm chỉ hiện với entity master-data). Quyền: `SYSTEM_SETTING_MANAGE` (tái dùng, tránh seed permission mới).
- **Badge dùng chung:** component `<StatusBadge entity code />` đọc nhãn/màu từ cache options (nạp 1 lần/entity). Thay các badge hardcode (Bank/Customer/Partner/POS/HKD) sang component này.
- **Filter/Form select:** options lấy từ `statusOptionList(entity)`.
- StatBar bộ đếm theo trạng thái: lặp theo options (mọi trạng thái có bản ghi → hiện; builtin luôn hiện).

## 8. Cross-cutting completion gate (memory feedback_cross_cutting_ui_completion_gate)
Liệt kê ĐỦ trang có status → checklist → mở app verify từng trang. Trang phải wire:
- [ ] Ngân hàng (BankConfigPage/BankTab)
- [ ] Khách hàng (CustomersPage)
- [ ] Đối tác (BankConfigPage/PartnerTab) — mới
- [ ] Tình trạng máy POS (PosSupplyPage/PosPage)
- [ ] MST hồ sơ HKD (DossierPage)
- [ ] (hiển thị-only, builtin-locked) Vòng đời TID, Duyệt hủy bill, Phiếu thu/chi
- [ ] Trang cấu hình "Trạng thái" mới

## 9. Regression (test process failure principle)
- selftest `status-catalog`: seed builtin đủ; create custom (master-data OK, state-machine bị chặn); update builtin không đổi code; delete custom đang-dùng bị chặn; assertStatusValid.
- selftest partner: status default UNSIGNED, filter theo status, đổi status, đếm theo status.
- Thêm vào suite `GLB_SELFTEST` + chạy FULL sau khi đổi schema (memory feedback_audit_full_selftest_after_infra_change).

## 10. Thứ tự thi công (sau khi 2 agent R8–R12 xong, giải phóng file)
1. schema.prisma + migration SQL (StatusOption + partner.status + seed) → backup glb → migrate deploy (throwaway verify trước).
2. status-catalog-service.ts + bank-config-service partner.status + validation.
3. ipc.ts + preload (index.ts/.d.ts).
4. UI: StatusBadge dùng chung + trang cấu hình Trạng thái + wire 5 trang master-data + PartnerTab (address column + status).
5. Gate FULL: typecheck + build + vitest + audit:protected/deferred + GLB_SELFTEST toàn bộ.
6. Commit + tag → đóng exe → Desktop + feed.
</content>
