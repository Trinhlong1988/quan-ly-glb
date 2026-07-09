# DESIGN PROPOSAL — POS/TID Asset Library + Cashflow (tư vấn, DRAFT/PENDING)

> Trạng thái: **APPROVED để BUILD phần A (POS/TID) + D (mã NV/KH + KH nickname)** — Mr.Long chốt 9/7 ("chốt thiếu bổ xung sau"). Phần B (thu chi) VẪN chờ lệnh nghiên cứu thị trường. Mở rộng IMS_SPEC roadmap. Grounded trên dữ liệu thật `globeway-quanlytaikhoan/qlpos-tid-master.json` (991 POS / 163 user / 9 bank).
> Bổ sung menu: **12. Quản lý thu chi · 13. Hướng dẫn sử dụng · 14. Đăng xuất** (14 đã có ở G1).

---

## PHẦN A — THƯ VIỆN QUẢN LÝ MÁY POS / TID (lõi nghiệp vụ GLOBEWAY)

### A0. Vấn đề Mr.Long nêu (chuẩn hóa lại)
- 1 máy POS vật lý (serial number) **gắn nhiều TID theo thời gian** (TID chết/đóng → thay TID; hoặc thu hồi cả TID+máy).
- Máy POS: hư → bảo trì → sửa xong; luân chuyển kho ↔ khách ↔ đại lý này sang đại lý khác.
- **Bắt buộc: lịch sử thao tác** (di chuyển/chuyển đổi/thu hồi/báo hỏng/gửi sửa/nhận sửa xong) **có timestamp cụ thể**, dễ tra.
- Danh sách **TID chưa giao** + **push thông báo mỗi ngày** (chưa giao = lãng phí, không ra doanh thu).

### A1. Nguyên tắc thiết kế TỐI ƯU: **Event Sourcing (nhật ký sự kiện bất biến)**
Không lưu chỉ "trạng thái hiện tại" — lưu **mọi sự kiện** đã xảy ra. Trạng thái hiện tại = chiếu (project) từ chuỗi sự kiện. Đây là chuẩn vàng cho tài sản có vòng đời phức tạp + yêu cầu "lịch sử chi tiết" + audit tài chính. Lợi ích: tra được "máy này ở đâu ngày X", ai thao tác, không mất lịch sử khi đổi TID/đại lý.

### A2. Thực thể (entities)
| Bảng | Vai trò | Field chính |
|------|---------|-------------|
| `pos_device` | Máy POS vật lý (danh tính = **serial number bất biến**) | serial, model, bank, currentStatus, currentAgentId, currentMerchantId, currentTid, warehouseLoc |
| `tid` | Terminal ID | tid, mid, bank, status (UNASSIGNED/ACTIVE/DEAD/CLOSED/RECALLED), posSerial?, merchantId?, agentId?, openedAt, closedAt |
| `merchant` | Khách hàng/điểm bán | id, name, taxCode, address, agentId |
| `agent` | Đại lý | id, name, region |
| `asset_event` | **NHẬT KÝ BẤT BIẾN** (lõi) | id, deviceSerial?, tid?, eventType, fromState, toState, fromAgentId?, toAgentId?, merchantId?, actorUserId, occurredAt, note, beforeJson, afterJson |
| `pos_tid_binding` | Gắn POS↔TID theo thời gian (đóng/mở) | posSerial, tid, boundAt, unboundAt, unbindReason |

**Quan hệ POS↔TID:** 1 POS tại 1 thời điểm có tối đa 1 TID ACTIVE, nhưng **nhiều binding lịch sử**. `pos_tid_binding` giữ lịch sử; `asset_event` giữ lý do + timestamp.

### A3. Máy trạng thái (state machine) — mỗi chuyển tiếp = 1 `asset_event`
**POS device:**
```
IN_STOCK ──deploy──▶ DEPLOYED(AT_MERCHANT) ──recall──▶ IN_STOCK
   ▲                       │
   │                    report_damage
 receive_repaired           ▼
   └──────── IN_REPAIR ◀── send_repair
DEPLOYED ──transfer_agent──▶ DEPLOYED (đại lý khác)
bất kỳ ──retire──▶ RETIRED (thanh lý)
```
**TID:** `UNASSIGNED → ACTIVE(gắn POS) → DEAD|CLOSED → RECALLED`. Thay TID = TID cũ DEAD + unbind + TID mới ACTIVE + bind (2 event, cùng deviceSerial).

**eventType tối thiểu:** `STOCK_IN, STOCK_OUT/DEPLOY, RECALL, TRANSFER_AGENT, REPORT_DAMAGE, SEND_REPAIR, RECEIVE_REPAIRED, TID_ASSIGN, TID_DEAD, TID_REPLACE, TID_RECALL, RETIRE`. Mỗi event có `occurredAt` (thời gian thao tác thực, khác created_at) → "thời gian cụ thể chi tiết" như Mr.Long yêu cầu.

### A4. Feature 1 — Thư viện POS có lịch sử
- Trang **danh sách POS** (lọc theo bank/đại lý/trạng thái/serial), mỗi máy có **Timeline** dựng từ `asset_event` (dòng thời gian: ngày → sự kiện → ai làm → ghi chú).
- Trang **TID**: TID nào đang gắn máy nào, lịch sử đổi TID.
- Thao tác đều tạo event + audit (kế thừa guard/audit G1).

### A5. Feature 2 — TID chưa giao + Push hằng ngày
- View **"TID chưa giao"** = `tid.status = UNASSIGNED` (hoặc ACTIVE nhưng chưa bind POS/merchant). Thêm **aging**: số ngày chưa giao (openedAt→nay) → nhấn mạnh lãng phí.
- **Scheduled job (cron mỗi sáng)** tổng hợp: N TID chưa giao, tổng ngày tồn, top lâu nhất → **push Zalo** (tái dùng hạ tầng gửi Zalo QLTK đã có [[project pattern]]) + toast/notification in-app.
- KPI: giảm số TID chưa giao = tăng doanh thu.

### A6. Bảo mật dữ liệu (Mr.Long nhấn mạnh)
- TID/MID/merchant/tax = **dữ liệu tài chính nhạy cảm** → permission riêng (`POS_VIEW/POS_MANAGE/TID_MANAGE/ASSET_EXPORT`), audit mọi truy cập + export.
- Mã hóa field nhạy cảm ở rest (SQLite: mã hóa cột hoặc SQLCipher khi lên .exe); export cần quyền + ghi audit.
- **Hành vi user / vi phạm:** audit_logs đã có (G1) = nền "lịch sử user"; thêm bảng `user_violation` (loại vi phạm, mức, người ghi, thời gian) + rule cảnh báo (vd thao tác ngoài giờ, export hàng loạt).

---

## PHẦN B — QUẢN LÝ THU CHI (item 12) — cần NGHIÊN CỨU THỊ TRƯỜNG
Mr.Long yêu cầu "phân tích app sẵn thị trường tối ưu". Đề xuất **nghiên cứu sâu** các app VN: KiotViet, MISA (SME/CukCuk), Sapo, POS365, Haravan — về module thu-chi/sổ quỹ:
- Danh mục thu/chi, quỹ tiền mặt vs tài khoản ngân hàng, phiếu thu/phiếu chi, đối tượng (khách/NCC/nội bộ), báo cáo dòng tiền, đối soát.
- Điểm tối ưu để bê vào IMS: liên kết doanh thu POS/TID ↔ thu chi; đối soát với tool bill/sao kê đã có.
→ **Cần Mr.Long duyệt cho em chạy deep-research** (web) rồi ra `docs/CASHFLOW_MARKET_RESEARCH.md` + đề xuất data model thu chi.

## PHẦN C — Item 13 Hướng dẫn sử dụng / Item 14 Đăng xuất
- **14 Đăng xuất:** ĐÃ có ở G1 (topbar + sidebar). ✅
- **13 Hướng dẫn sử dụng:** trang in-app (markdown viewer) + `docs/USER_GUIDE.md` — làm cùng Phase hoàn thiện UI.

---

## PHẦN D — MÃ ĐỊNH DANH TỰ SINH (Mr.Long yêu cầu 9/7)
- **Mã nhân viên** `NV01, NV02, NV03...` — auto-sinh **khi tạo user**, unique, **hiển thị đính kèm** ở list/chi tiết/form nhân sự. Cột `users.employee_code`.
- **Mã khách hàng** `KH01, KH02, KH03...` — auto-sinh **ngay lúc khởi tạo** khách hàng, unique, **hiển thị đính kèm khách hàng** (mọi nơi hiện tên KH đều kèm mã). Cột `customer.code` (thực thể `merchant`/`customer`).
- **Khách hàng có 2 tên:** `full_name` (tên thật, vd "Nguyễn Văn Thanh") + `nickname`/biệt danh **dễ gọi** (vd "Anh Thanh Hải Phòng") — trường bắt buộc cho KH, dùng để tìm/gọi nhanh. Hiển thị dạng `KH03 · Anh Thanh Hải Phòng (Nguyễn Văn Thanh)`.
- **User nhân sự KHÔNG cần biệt danh** — chỉ `full_name` + mã `NV##`.
- **Cơ chế sinh mã (atomic):** bảng `code_counter(prefix, last_value)` — sinh trong transaction (`last_value+1`), zero-pad tối thiểu 2 chữ số (`NV01`, tràn `NV100`). KHÔNG dùng id thô (id có thể nhảy). Prefix cấu hình được (NV/KH/POS...).
- Migration cho user cũ (adminroot) → cấp mã `NV01` (hoặc mã hệ thống riêng). Đối chiếu unique khi import dữ liệu 991 POS/163 user cũ.
- **Regression:** test "mã sinh liên tục không trùng, không nhảy sai prefix, concurrent-safe trong 1 process".

## PHẦN E — LUẬT CẢNH BÁO UX (Mr.Long lock 9/7, áp GLOBAL mọi phase)
**R_UX_WARN:** Mọi thao tác sai / trùng lặp / nguy hiểm **BẮT BUỘC** hiện dialog/toast cảnh báo **RÕ RÀNG + message cụ thể**, KHÔNG im lặng fail:
- **Trùng dữ liệu** → chỉ rõ trùng cái gì: "Tên đăng nhập *nguyenvana* đã tồn tại", "Mã KH *KH03* đã tồn tại", "Serial POS *X* đã tồn tại", "TID *Y* đã tồn tại", "Email đã được dùng".
- **Sai xác thực** → "Sai mật khẩu", "Mật khẩu xác nhận không đúng", "Bạn không có quyền thực hiện".
- **Sai validate** → nêu đúng lỗi (username sai quy tắc, thiếu biệt danh KH, thiếu vai trò...).
- **Thao tác nguy hiểm** (xóa/thu hồi/retire/restore/khóa) → **ConfirmDialog có nút Hủy + cảnh báo hậu quả** ("Sẽ xóa mềm KH03...", "Không thể hoàn tác"), xóa cần nhập lại mật khẩu.
- Mỗi kết quả thao tác đều có **toast** ✔ thành công / ✖ lỗi. Lỗi hệ thống bất ngờ cũng phải toast, không nuốt exception.
Kế thừa pattern G1 (service trả `{ok,error,message}` tiếng Việt cụ thể + toast + ConfirmDialog). Regression: test mỗi service trả message đúng cho từng loại lỗi.

**R_UX_FILTER (Mr.Long lock 9/7, GLOBAL):** **MỌI danh sách hiển thị** (users, KH, POS, TID, ngân hàng, đối tác, NCC, hồ sơ, TK ủy quyền, doanh số, thu chi, audit...) **BẮT BUỘC có thanh lọc** gồm — tùy dữ liệu:
- **Từ ngày → đến ngày** (date range) — luôn có nếu list có yếu tố thời gian.
- Các chiều liên quan: **đại lý / tên đại lý, mã KH (KH##), TID, tên HKD, ngân hàng, đối tác, loại thẻ, trạng thái, mã NV**...
- Kèm ô **tìm kiếm text** + nút **Làm mới**. Lọc phía server (service nhận filter params), phản hồi realtime. Mọi list cũng nên có **Xuất Excel** (theo spec).
Chuẩn hóa 1 component `<FilterBar>` tái dùng để mọi trang đồng nhất.

## PHẦN F — QUẢN LÝ DOANH SỐ (Mr.Long spec 9/7, item 3 — quan trọng)
Menu (em sắp xếp): mục **Quản lý Doanh số**. Click → màn nhập hóa đơn doanh số:

**F1. Bảng setup — chọn TID:** chọn TID → tự show: **HỘ KINH DOANH (HKD)**, **Phí mua**, **Phí cài máy**, **Phí bán (%)**, và **TID này giao cho khách nào**: `tên KH – mã KH (KH##)`, **ngày giao**.

**F2. Cấu hình LOẠI THẺ (library — kiểm tra có chưa, chưa thì bổ sung):**
- Mỗi `loại thẻ` có **giá mua**, **giá cài máy**, **giá bán** RIÊNG. Bảng `card_type(code, name, buyPrice, installPrice, sellPrice/sellRatePct, active)`.
- Khi nhập doanh số phải **chọn loại thẻ** → lấy giá theo loại thẻ đó.

**F3. Nhập hóa đơn doanh số:**
- **Doanh số**: số, format nghìn (1,000,000,000), không giới hạn.
- **Loại thẻ**: chọn từ cấu hình F2.
- **Thời gian**: từ ngày dd/mm/yy → đến ngày dd/mm/yy.
- Nhập xong **tự tính** (realtime): **thành tiền phí chênh thu của Khách hàng** + **thành tiền phí chênh thu của Đối tác** = `% phí chênh × doanh số`.
- Nút **Xác nhận / Hủy bỏ**.

**F4. Hiển thị & truy vết:**
- Danh sách hóa đơn doanh số **realtime** dưới form: **STT · Thời gian (từ–đến) · TID · Tên HKD · Khách hàng (KH##) · Doanh số · % phí chênh · Thành tiền phí chênh** · **Tổng** từng loại phí ở dưới.
- Thao tác xong **push thông báo**; **R_UX_WARN** (trùng lặp/sai → dialog rõ ràng nổi bật); đảm bảo audit truy vết.

**F5. CÔNG THỨC (đã có trong IMS_SPEC dòng 1169-1171 — XÁC NHẬN):**
- Cấu hình phí per (**đối tác × ngân hàng × loại thẻ**): `buyPct` (Phí mua %), `installPct` (Phí cài máy %), `sellPct` (Phí bán %). Tối đa 3 số thập phân (1.067).
- **Phí chênh với NCC/Đối tác (%) = Phí mua(%) − Phí cài máy(%)** → hiển thị: âm = đỏ trong ngoặc, dương = xanh dương.
- **Phí chênh với Khách hàng (%) = Phí bán(%) − Phí cài máy(%)**.
- **Thành tiền phí chênh = % chênh × doanh số**.
- ⚠️ Lưu ý (spec mục 11): lúc **giao TID** có **giá thực bán per khách hàng** (khác giá niêm yết) — doanh số nên tính theo **giá thực bán của TID đó**, không phải giá niêm yết. Giá mua/cài niêm yết, chỉ giá bán tùy chỉnh.
- Data model: `revenue_invoice(id, tid, hkdId, customerId, cardTypeId, revenue, dateFrom, dateTo, feePctCustomer, feePctPartner, amountCustomer, amountPartner, createdBy, createdAt)` + nguồn phí lấy từ `fee_config` của TID.

## PHẦN G — QUY TRÌNH BUILD UI DEMO (Mr.Long lock 9/7)
- **R_PROCESS_FEATURE_GATE:** build **từng tính năng** ra UI → CMD_AUDIT **review + chạy pass ngay** (mở app, screenshot, click thử, không lỗi console) → commit → **mới build tính năng kế**. CẤM gộp nhiều tính năng chưa review. Mỗi tính năng = 1 gate.
- **R_UI_DESKTOP_CONSISTENT:** UI phải **giống thiết kế app cài .exe**, dùng **1 design system nhất quán** — tái dùng component sẵn có (`Modal`, `ConfirmDialog`, `StatusPill`, `Field`, `toast`, sidebar navy, topbar, `<FilterBar>`), palette KiotViet (brand `#1657D0`, sidebar `#10233F`, bg `#F4F6FA`), font Be Vietnam Pro. KHÔNG mỗi trang một kiểu. Mọi màn: sidebar + topbar + breadcrumb + content card + bảng có FilterBar + Xuất Excel.

## ĐỀ XUẤT ĐƯA VÀO ROADMAP (sửa IMS_SPEC §22)
| Phase | Nội dung (cập nhật) |
|-------|---------------------|
| G1 | Auth/Role/User/Audit/Backup (đang đóng .exe) |
| **G-POS** (mới, ưu tiên cao vì lõi GLOBEWAY) | Thư viện POS/TID event-sourced + lịch sử + TID chưa giao + push |
| G4 | **Thu chi** (sau nghiên cứu thị trường) |
| G8 | Report/Excel/PDF |
| G10 | VPS + PostgreSQL sync |

## CẦN Mr.Long QUYẾT
1. Duyệt kiến trúc **event-sourcing** cho POS/TID? (khuyến nghị — chuẩn vàng cho asset lifecycle).
2. Cho em **chạy deep-research thị trường thu chi** (web) không?
3. Thứ tự: đóng nốt **.exe G1 trước** rồi làm **G-POS**, hay ưu tiên G-POS luôn?
