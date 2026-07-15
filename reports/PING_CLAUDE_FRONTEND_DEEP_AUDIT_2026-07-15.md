# PING CLAUDE — Frontend deep audit trên code hiện tại

**Repo:** `D:\TT HKD AI\tools\quan-ly-glb`  
**Phạm vi:** renderer React, components, pages, preload contract và realtime.  
**Nguyên tắc:** các mục dưới đây là phát hiện từ code path hiện tại; Claude phải tự tái hiện từng mục, ghi `REPRODUCED` hoặc `REJECTED` cùng output/exit-code trước khi sửa. Không được báo cáo lỗi chỉ dựa trên UI hoặc sửa theo suy đoán.

## Kết quả kiểm chứng nền

- `npm run typecheck --workspace @glb/desktop`: đã chạy trước đó, exit 0.
- `npm run build`: đã chạy trước đó, exit 0.
- `npm run lint`: **exit 1 — Missing script: lint** ở root; repo không có gate lint chính thức.

## Lỗi đã chỉ ra bằng code path

### FE-01 — Ngày/giờ Export nhập nhưng không gửi xuống backend (High)

`components/ExportRequestPanel.tsx:259-261` có state `reqDate`, `reqTime`; người dùng có thể chọn ngày/giờ. Nhưng object gửi tại `:308-323` không có hai field này, rồi `exportReqCreate(input)` ở `:325`.

**Tái hiện:** chọn `2000-01-01 00:01`, submit, đọc request/database; giá trị được lưu không phải giá trị người dùng chọn mà backend mặc định.

**Phản biện cần bác:** chỉ được coi false positive nếu contract backend cố ý không có ngày/giờ yêu cầu và UI field phải bị bỏ. Nếu nghiệp vụ cần timestamp thì đây là mất dữ liệu chắc chắn.

### FE-02 — Reset filter dùng closure cũ (Medium)

`CustomersPage.tsx:91-96` set các state về rỗng rồi gọi `setTimeout(reload, 0)`. `reload` là closure của render trước nên vẫn dùng `search/status/fromDate/toDate` cũ; trang không có effect phụ thuộc filter để bù lại.

**Tái hiện:** lọc khách, bấm Xóa lọc, bắt IPC `customerList`; payload vẫn chứa bộ lọc cũ.

Tương tự cần kiểm tra `CashflowReportPage.tsx:78` và các trang có pattern `setTimeout(reload,0)`.

### FE-03 — IPC reject làm loading kẹt vĩnh viễn (High/Medium)

Các reload ở `CustomersPage.tsx:69-84`, `StaffPage.tsx:73-79`, `PosPage.tsx:135-149`, `CashEntryPage.tsx:85-100`, `RevenuePage.tsx:161-185` đặt `loading=true` nhưng không có `try/finally`. Nếu IPC reject, `setLoading(false)` không chạy.

**Tái hiện:** mock `window.api.*List` reject; gọi reload; spinner vẫn hiện vô hạn và người dùng không thao tác được.

### FE-04 — Promise.all làm hỏng cả màn hình khi một API lỗi (Medium)

`RevenuePage.tsx:174-184` và `DebtPage.tsx:102-110` gom nhiều API trong `Promise.all`; chỉ một endpoint reject là toàn bộ reload reject, thường kéo theo FE-03.

**Tái hiện:** cho `transactionList` thành công nhưng `revenueReport` reject; kiểm tra bảng, summary, loading và toast. Không được để dữ liệu cũ bị diễn giải là dữ liệu mới.

### FE-05 — Lọc ngày bị lệch timezone (High/Medium)

`RevenuePage.tsx:132-145`, `DebtPage.tsx:72-78` biến `yyyy-mm-dd` thành `new Date(...T00:00:00).toISOString()`. Ở `Asia/Saigon`, `2026-07-15T00:00` thành UTC `2026-07-14T17:00`; query ngày có thể ăn thêm ngày trước.

**Tái hiện:** chạy TZ `Asia/Saigon`, lọc đúng một ngày, log payload và kết quả server.

### FE-06 — Gán TID cho customer không bắt buộc serial máy khách (High)

`TidPage.tsx:950-972` nhánh `assignMode='customer'` tạo payload `customerDeviceSerial: null` nhưng vẫn cho gán customer.

**Tái hiện:** chọn mode customer, bỏ serial máy khách, submit; kiểm tra TID sau lưu. Nếu spec yêu cầu máy khách là quan hệ con bắt buộc, đây là orphan nghiệp vụ.

### FE-07 — Giá bán POS nhận `Infinity` và mất chính xác (High)

`PosPage.tsx:534-548` dùng `Number(salePrice) || 0`; chuỗi `Infinity` trở thành `Infinity`, vượt qua `price > 0`, rồi gửi IPC. Số lớn cũng bị làm tròn.

**Tái hiện:** nhập `Infinity` hoặc giá `9007199254740993`; kiểm payload `deviceSellPos` và số tiền DB.

### FE-08 — Dữ liệu POS/TID stale trước khi approve Export (High)

`ExportApprovalPage.tsx:210-228` tải danh sách một lần và lọc tại renderer (`currentTid`, `delivered`, `status`). Không có request-id/refresh lúc submit.

**Tái hiện:** mở màn approve, client khác xuất/assign thiết bị, quay lại approve danh sách cũ; UI vẫn cho chọn. Backend phải recheck, nhưng frontend hiện tạo ảo giác dữ liệu hợp lệ.

### FE-09 — Load refs theo `kind` có race (Medium)

`ExportRequestPanel.tsx:265-273` chạy năm API song song mỗi khi `kind` đổi, không abort hoặc sequence. Chuyển POS→TID nhanh có thể để response POS cũ ghi đè dropdown TID (hoặc ngược lại).

**Tái hiện:** mock delay khác nhau cho từng API, đổi kind liên tục, kiểm banks/customers/funds/partners/feeTypes.

### FE-10 — DateInput không đồng bộ khi parent đổi value (Medium)

`components/DateInput.tsx:14-19` chỉ khởi tạo state từ `value` một lần; comment `:11-12` còn tuyên bố không cần sync. Nếu form giữ component mounted rồi parent reset/chuyển bản ghi, input hiển thị và submit ngày cũ.

**Tái hiện:** render value A, đổi prop sang B mà không remount, submit; DOM và callback vẫn dùng A.

### FE-11 — Modal Enter bỏ qua validation/busy và double-submit (High)

`components/Modal.tsx:39-49` bắt Enter ở container và gọi `onSubmit()` trực tiếp. Nó không biết form validation, `busy` hay button disabled. Nút X `:53-55` cũng thiếu `type="button"`.

**Tái hiện:** trong form đang busy hoặc input còn invalid, nhấn Enter; callback save vẫn chạy. Nhấn nhanh hai lần tạo hai request.

### FE-12 — SearchSelect không dùng được bằng bàn phím (Medium)

`components/SearchSelect.tsx:72-78` reset query khi focus nhưng thiếu `onKeyDown`, role combobox/listbox, active descendant và Escape/Arrow/Enter. Keyboard-only user không chọn được option.

### FE-13 — Attachment hiển thị nhầm ảnh và giữ ảnh cũ khi lỗi (Medium)

`components/Attach.tsx:9-13` gọi async `readAttachment(relPath)` không sequence/cancel và không `setUrl(null)` khi path đổi. Promise A trả sau B có thể ghi ảnh A; B lỗi vẫn giữ ảnh A.

**Tái hiện:** delay IPC A/B, đổi prop nhanh; hoặc đổi từ path hợp lệ A sang path lỗi B.

### FE-14 — Update có thể chạy nhiều download/install song song (High)

`components/UpdateBanner.tsx:65-68` không guard `busy/phase`; nút vẫn gọi `startUpdate()` trước event progress. `doInstall` ở `:75-77` cũng không khóa lặp.

**Tái hiện:** click “Cập nhật ngay” liên tục khi mạng chậm; đếm số IPC `startUpdate`/download.

### FE-15 — MessagesDrawer báo thành công giả khi IPC lỗi (Medium)

`components/MessagesDrawer.tsx:46-73` reload không sequence; `markAll`/read không kiểm `res.ok` nhưng vẫn cập nhật local/toast thành công. `onChanged` cũng gọi sau reload thất bại.

**Tái hiện:** reject `message.markAllRead`; UI vẫn báo đã đọc hết và parent giảm badge dù DB chưa đổi.

### FE-16 — Realtime ACK trước reload (Medium)

`lib/realtime.tsx:54-56,61-73`: click banner gọi `ack()` trước `onReload()`. Reload lỗi thì token đã được ACK, banner biến mất trong khi bảng vẫn cũ.

### FE-17 — Realtime version BigInt bị ép Number (High khi token lớn)

`realtime-service.ts:25` dùng `Number(t.version)`. Hai BigInt khác nhau trên `2^53` có thể thành cùng Number, khiến frontend bỏ qua thay đổi.

**Tái hiện:** tạo version `9007199254740992n` và `9007199254740993n`, chạy token poll, so sánh badge.

### FE-18 — File path Windows có thể bị từ chối sai

`apps/desktop/src/main/ipc.ts:325` suy ra loại file bằng `split('/')`. Rel path dùng backslash Windows (`dossier\\1\\x.png`) bị coi toàn chuỗi là kind và trả FORBIDDEN dù file hợp lệ.

**Tái hiện:** gọi `file:read` với path backslash và forward slash tương đương; so sánh kết quả.

## Checklist Claude phải điền

| ID | REPRODUCED/REJECTED | Command/test + output | Sửa ở đâu | Regression test |
|---|---|---|---|---|
| FE-01…FE-18 | bắt buộc từng dòng | bắt buộc | bắt buộc | bắt buộc |

Không chấp nhận “typecheck xanh” làm phản bác. Với các mục về stale/race/loading, phải dùng test fake timer/deferred Promise; với tiền/ngày phải chạy giá trị lớn và timezone thật; với Export/approve phải kiểm cả backend recheck và dữ liệu trước–sau.

## Kết luận

Frontend hiện build được nhưng còn lỗi mất dữ liệu người dùng nhập, hiển thị stale, sai ngày tiền, báo thành công giả, request trùng và quan hệ tài sản không được xác nhận lại. Claude phải xử lý từng ID bằng agent audit độc lập, tự tay chạy command/test và chỉ báo PASS sau khi không còn case tái hiện.
