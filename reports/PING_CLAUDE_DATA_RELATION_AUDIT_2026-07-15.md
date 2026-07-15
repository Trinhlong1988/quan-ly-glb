# PING CLAUDE — Đợt 2: kiểm toán quan hệ dữ liệu mẹ–con và vòng đời

**Repo:** `D:\TT HKD AI\tools\quan-ly-glb`  
**Báo cáo nền:** [PING_CLAUDE_ADVERSARIAL_AUDIT_2026-07-15.md](./PING_CLAUDE_ADVERSARIAL_AUDIT_2026-07-15.md)  
**Nguyên tắc chống báo cáo láo:** Không xem một dòng code là bug nếu chưa có đường tái hiện, invariant/spec đối chiếu và phản biện false-positive. Claude phải tự chạy lại từng case bên dưới bằng agent audit độc lập; case nào không tái hiện phải đánh dấu `REJECTED`, không sửa theo phỏng đoán.

## Mệnh lệnh kiểm chứng bắt buộc

1. Đọc `bible/00_constitution.md`, `docs/IMS_SPEC_v1_0.md`, `docs/POS_SALE_DEBT_SPEC.md` và báo cáo nền trước khi sửa.
2. Với mỗi ID: ghi `REPRODUCED` hoặc `REJECTED`, command/test, output/exit-code, dữ liệu trước–sau, rồi mới sửa.
3. Không dùng UI làm ranh giới bảo mật; kiểm chứng ở service/IPC/DB.
4. Mỗi invariant mẹ–con phải có test insert/update/delete trực tiếp và test qua IPC/service.
5. Sau mỗi sửa: thêm regression test, chạy `npm run verify`, `npm run build`, và kiểm tra lại dữ liệu PostgreSQL thật. Không claim PASS chỉ vì TypeScript/Vitest xanh.

## Các lỗi có bằng chứng trực tiếp

### REL-01 — Hầu hết quan hệ mẹ–con không có foreign key DB (High/Critical)

**Bằng chứng:** Các cột `Customer.agentId`, `PosDevice.currentCustomerId/warehouseId/posModelId/supplierId/bankId`, `Tid.customerId/partnerId/dossierId/industryId`, `Transaction.tidId/customerId/cardTypeId/feeTypeId`, `DeviceSale.customerId` chỉ là scalar (`packages/database/prisma/schema.prisma:213,235-250,275-292,319-323,481-489`). `rg "FOREIGN KEY|REFERENCES" packages/database/prisma/migrations --glob '*.sql'` chỉ thấy constraint auth tại baseline `:759-774`, không có FK nghiệp vụ.

**Tái hiện cần chạy:** `INSERT INTO transactions(tid_id,customer_id,amount,status,txn_date) VALUES (999999,999999,1,'POSTED',now());` hoặc `UPDATE pos_devices SET warehouse_id=999999 WHERE id=...;`.

**Kết quả lỗi:** DB nhận orphan; JOIN/report/thu nợ không tìm được mẹ. Service guard không bảo vệ raw SQL, restore, import hoặc writer mới.

**Phản biện:** Nếu spec cố ý không FK để hỗ trợ soft-delete, phải chứng minh bằng migration/test rằng mọi writer đều validate và có orphan scanner. Nếu không, đây là lỗi integrity.

### REL-02 — Status là TEXT, không có CHECK/enum (High)

`schema.prisma` dùng `String`; migrations không có CHECK cho status. `UPDATE tids SET status='ACTIVE '` hoặc `UPDATE customers SET status='FOO'` vẫn commit.

**Tác động:** filter/report chỉ biết status chuẩn sẽ bỏ sót dữ liệu; vòng đời bị phá bởi typo/import/restore.

**Không được sửa mù:** Claude phải liệt kê toàn bộ enum hợp lệ từ spec và kiểm tra dữ liệu hiện có trước khi thêm CHECK/migration.

### REL-03 — Không có CHECK bảo vệ trạng thái–quan hệ mẹ–con (High)

Schema không ép các quan hệ như `TID ACTIVE` phải có/không có customer/pos; `PosDevice IN_STOCK` phải có warehouse và không có currentTid. SQL có thể commit các trạng thái mâu thuẫn.

**Tái hiện:** `UPDATE tids SET status='ACTIVE', customer_id=NULL;` hoặc `UPDATE pos_devices SET status='IN_STOCK', warehouse_id=NULL,current_tid='T1';`.

**Phản biện:** Flow `tid-service` có guard chỉ chứng minh một đường gọi; không bảo vệ DB trực tiếp, restore và bug ở writer khác.

### REL-04 — TID có ba nguồn sự thật không đồng nhất (High)

TID giữ đồng thời `customerId`, `dossierId`, `hkdName` (`schema.prisma:283-292`). Không có ràng buộc dossier–customer và `hkdName` là snapshot tự do. Transaction/report lấy customer theo `tid.customerId` (`transaction-service.ts` khoảng `270-273`), còn UI có thể hiển thị HKD theo dossier.

**Tái hiện:** đặt `dossier_id=A, customer_id=B, hkd_name='C'`; truy vấn ba màn hình cho ba chủ thể khác nhau.

**Cách xử lý bắt buộc:** chọn một nguồn sự thật hoặc ghi rõ snapshot lịch sử; thêm invariant test, không chỉ “đồng bộ UI”.

### REL-05 — Soft-delete Customer bỏ sót quan hệ con (High)

`customer-service.ts:282-289` chỉ kiểm tra POS/TID đã giao và deposit OPEN trước khi xóa. Không kiểm tra `DeviceSale`, `Transaction`, `CashEntry`, `ExportRequest`/approval.

**Tái hiện:** tạo sale/giao dịch/phiếu thu cho customer rồi gọi delete customer; nếu thành công, các con POSTED vẫn sống nhưng map customer trong report trả null.

**Phản biện:** giữ lịch sử là đúng, nhưng phải giữ snapshot/hiển thị mẹ đã xóa nhất quán và cấm tạo mới; không được để orphan logic im lặng.

### REL-06 — Unique “bản ghi sống” chỉ enforce ở service (Medium/High)

Các invariant `(tid,card,fee)`, kỳ FeeRate/FeeSellQuote cố ý không có partial unique DB (`schema.prisma` khoảng `797-850`). Hai writer concurrent hoặc restore có thể tạo hai dòng `deletedAt IS NULL`.

**Tái hiện:** hai transaction cùng INSERT cùng khóa sống; DB không chặn. Cần chạy trên PostgreSQL thật, không suy diễn từ unit test.

### REL-07 — Bán TID qua Export không chuyển trạng thái SOLD (Critical)

`export-request-service.ts:416-455` nhánh SALE tạo `DeviceSale`/cash nhưng chỉ cập nhật `deliveredAt/customerId/agentId`, không cập nhật `Tid.status='SOLD'`. Đối chiếu `docs/POS_SALE_DEBT_SPEC.md:29-31`: TID bán phải SOLD; `sellTid` chỉ cho UNASSIGNED/ACTIVE nên TID đã bán có thể bán lại.

**Tái hiện:** tạo Export TID kind SALE, approve một line, sau đó gọi sell TID cùng mã. Phải chứng minh trạng thái và hai DeviceSale trước/sau.

### REL-08 — Export riêng TID đang gắn POS (Critical)

`processTidLineTx` kiểm delivered/customer/bank/partner nhưng không chặn `row.posSerial != null`. Nó có thể đổi customer/deliveredAt trong khi `PosDevice.currentTid` vẫn trỏ TID.

**Tái hiện:** bind TID–POS, tạo Export TID standalone, approve; kiểm hai bản ghi sau approve.

### REL-09 — Bán POS với `currentTid` dangling vẫn thành công (High)

`device-sale-service.ts` nhánh bán kèm chỉ update TID nếu `findUnique` tìm thấy; nếu TID bị soft-delete/mất thì vẫn bán POS và set `currentTid=null`, sale giữ serial TID cũ nhưng không có TID_SELL/audit con.

**Tái hiện:** tạo POS.currentTid trỏ TID đã xóa mềm, gọi sell POS; transaction phải fail, không được tạo sale một phần.

### REL-10 — Dashboard tính cả POS đã soft-delete (Medium)

`dashboard-service.ts` khoảng `42` và `67` dùng `db.posDevice.count/findMany` không lọc `deletedAt:null`, trong khi TID/customer/dossier dùng alive filter.

**Tái hiện:** tạo POS, soft-delete, gọi dashboard; `counts.posDevices`/`posByStatus` vẫn tăng.

### REL-11 — Tiền BigInt bị ép Number, sai trên 2^53 (High)

`transaction-service.ts:58-63,430-470` và các summary/deposit lines khoảng `188-190` ép BigInt/amount sang `Number`. Giá trị `9007199254740993` thành `9007199254740992`.

**Tái hiện:** tạo giao dịch/deposit amount `'9007199254740993'`, đọc list/summary/settlement và so sánh chuỗi BigInt DB với DTO.

**Phản biện:** nếu UI giới hạn nhỏ hơn, phải enforce giới hạn rõ ở boundary; không được nhận BigInt lớn rồi âm thầm làm tròn.

### REL-12 — `Transaction.txnDate` lệch kiểu timezone

`schema.prisma:332` khai báo DateTime nhưng thiếu `@db.Timestamptz(3)`, không nhất quán với các DateTime khác. Cùng instant qua session timezone khác có thể rơi sang ngày/tháng khác trong report.

**Tái hiện:** ghi transaction gần nửa đêm với hai `TimeZone` PostgreSQL, so sánh `txnDate` và dashboard month bucket.

### REL-13 — Status typo bị tự động biến thành ACTIVE (Medium/High)

`bank-config-service.ts:117` và `warehouse-service.ts:165` normalize mọi giá trị khác `INACTIVE` thành `ACTIVE`, thay vì reject. Payload `INACTVE` vì vậy âm thầm re-activate bản ghi.

**Tái hiện:** IPC update status typo, đọc lại status và audit before/after.

### REL-14 — `moneyKind` DB cast mù qua enum (Medium/High)

`handover-service.ts` khoảng `235-256` cast string DB thành `MoneyKind` nhưng không reject giá trị lạ. Dữ liệu import `'UNKNOWN'` có thể lọt vào applyHandoverTx và tạo bút toán sai.

**Tái hiện:** sửa raw `handover_types.money_kind='UNKNOWN'`, chạy apply handover; phải bị từ chối trước transaction.

## Bảng trạng thái kiểm chứng

Các mục REL-01…REL-14 ở trên là **ứng viên có bằng chứng code/schema**. Claude phải điền thêm trong commit audit:

| ID | REPRODUCED/REJECTED | Command/test | Dữ liệu trước–sau | Sửa + regression test |
|---|---|---|---|---|
| REL-01…REL-14 | bắt buộc từng dòng | không chấp nhận “đã xem code” | bắt buộc | bắt buộc |

## Tiêu chí chống tái diễn và chống báo cáo sai

- Không đánh dấu fixed nếu chỉ thêm validation UI; phải chặn ở service và/hoặc DB.
- Không dùng `Number` cho tiền tùy ý; giữ BigInt/string tới renderer hoặc enforce bound có test.
- Không hard-delete/soft-delete mẹ nếu chưa có policy con: restrict, cascade, snapshot hoặc archive rõ ràng.
- Mọi transition mẹ–con phải atomic trong một transaction và có test cạnh tranh.
- Nếu chọn không thêm FK/CHECK vì tương thích dữ liệu cũ, phải có migration backfill + orphan scanner + test chứng minh lý do.
- Khi Claude phản bác một ID, phải ghi query đã chạy và output; phản bác bằng “không xảy ra qua UI” là không hợp lệ.
- Chạy lại toàn bộ báo cáo nền và báo cáo này; lỗi đã sửa phải không tái diễn.

## Kết luận

Đợt 2 phát hiện các lỗi có thể làm sai chủ thể, sai vòng đời tài sản, bán lại TID đã bán, mâu thuẫn POS–TID, orphan dữ liệu và sai số tiền lớn. **Không được claim PASS** cho tới khi từng ID có bằng chứng tái hiện hoặc phản bác bằng command/test độc lập, và mọi case được xử lý theo hiến pháp của repo.
