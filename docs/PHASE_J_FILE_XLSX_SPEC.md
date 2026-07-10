# PHASE J — Module File: Xuất/Nhập Excel (.xlsx) + Kéo-thả dùng chung

> Vai trò: KIẾN TRÚC SƯ (design). Tài liệu này CHỈ thiết kế — KHÔNG code, KHÔNG sửa `preload`/`schema`.
> Grounded trên code thật repo `quan-ly-glb` (Trinhlong1988/quan-ly-glb, main). Mọi chữ ký hàm/IPC dưới đây là **HỢP ĐỒNG ĐỀ XUẤT** để Mr.Long chốt trước khi CMD THỰC THI dựng.
> Phạm vi: task #8 (phần file) + #9. Áp cho Electron 33 + electron-vite + Prisma 7 (pg).

---

## 0. Hiện trạng đã kiểm chứng (evidence-first, R9)

| Hạng mục | Sự thật trong code | File:dòng |
|---|---|---|
| "Xuất Excel" hiện tại | **KHÔNG phải .xlsx** — là CSV UTF-8 BOM (`Blob` + `a.download`), mở được trong Excel nhưng là `.csv` | `apps/desktop/src/renderer/src/lib/exportCsv.ts:2` |
| API nút Xuất | `exportCsv(filename, headers, rows)` — **16 trang** đang gọi (Bank×3, Customers, Pos, PosSupply, Tid, Revenue, Debt, Audit, Approval…) | `pages/*.tsx` (16 call site) |
| Đính kèm ảnh/CCCD | `storeAttachment(kind,id,side,ownerName,srcAbsPath)` lưu NGOÀI DB tại `<userData>/uploads/<loại>/<id>/`, DB giữ relPath+tên gốc+**sha256**+size; ghi đè → `_trash`; chặn path-traversal; `GLB_UPLOADS_DIR` override | `main/file-store.ts:53` |
| Loại file cho phép (đính kèm) | `ALLOWED_EXT = {.png,.jpg,.jpeg,.pdf}`, MIME map | `main/file-store.ts:8` |
| Chọn file qua OS | IPC `file:pickImage` → `dialog.showOpenDialog(win,{properties:['openFile'],filters:[png,jpg,jpeg,pdf]})` → trả **abs path** | `main/ipc.ts:229` |
| Đọc file đã lưu | IPC `file:read` → `readAttachmentDataUrl(relPath)` (data URL, renderer sandbox không đọc fs) | `main/ipc.ts:237` |
| UI đính kèm | `AttachField`/`Thumb` gọi `window.api.pickImage()` → nhận abs path → truyền vào service. **Chưa có kéo-thả.** | `renderer/src/components/Attach.tsx` |
| Mẫu IPC | `ipcMain.handle('<ns>:<verb>', async (_e, args)=>svc(...))` + preload `contextBridge` `ipcRenderer.invoke` | `main/ipc.ts`, `preload/index.ts` |
| Cấu hình per-máy | `server-config.json`, `update-result.json` ghi thẳng vào `app.getPath('userData')` (JSON, `writeFileSync`) — KHÔNG vào DB | `main/db.ts:41`, `main/update-service.ts:94` |
| Setting trong DB | `appSetting` (bảng `app_settings`) là **cấu hình DÙNG CHUNG toàn server**, gate quyền `SYSTEM_SETTING_*` | `main/settings-service.ts` |
| Sinh mã | `nextCode(prefix, tx?)` atomic qua `codeCounter.upsert` (§D). KH01, POS…; nhận tx-client để gộp atomic | `main/code-service.ts:16` |
| Mẫu create atomic | `db.$transaction(tx => { code=nextCode('KH',tx); tx.customer.create(...) })` + `writeAudit` sau | `main/customer-service.ts:129` |
| Externalize lib runtime | `mainExternals = ['pg','@prisma/*','electron-updater']` — KHÔNG bundle, nạp lúc chạy | `apps/desktop/electron.vite.config.ts:11` |
| Nạp lib externalized | `const mod = await import('electron-updater')` trong nhánh `isPackaged`, bọc try/catch offline-safe | `main/update-service.ts:282` |
| Guard quyền | `requirePermission(code,{action,targetType})` → `{ok,db,user}` | `main/guard.ts` |
| Selftest | `GLB_SELFTEST=<N>` + `GLB_ROLE=server` + `GLB_DB_URL=<pg tạm>`; mỗi file `runXxxSelfTest()` đếm pass/fail, log `PASS/FAIL` | `main/selftest-*.ts`, `main/index.ts:60` |
| Typecheck | `tsc --noEmit` (KHÔNG `tsc -p` emit — hardlock chống emit-trap) | `apps/desktop/package.json:14` |

**Thực thể sẽ import (schema):**
- `Customer` (`customers`): `code`(KH## unique, sinh), `fullName`*, `nickname`*(BẮT BUỘC §D), `phone?`,`email?`,`address?`,`agentId?`,`note?` — `schema.prisma:186`
- `PosDevice` (`pos_devices`): `serial`*(unique = danh tính), `model?`,`bank?`,`status`(IN_STOCK|DEPLOYED|IN_REPAIR|DAMAGED|RETIRED, default IN_STOCK), `warehouseLoc?`,`note?` — `schema.prisma:206`
- `PosIntake` (`pos_intakes`): `posModelId`*,`serial`*(unique),`intakeStatusId`*,`supplierId`*,`importPrice`*(Int VND),`importedAt`*,`note?` — `schema.prisma:511`
- `Tid` (`tids`): `tid`*(unique),`mid?`, + nhiều FK optional `bankId/partnerId/receiveAccountId/configStatusId/dossierSourceId`, `hkdName?`,`note?` — `schema.prisma:224`

---

## 1. Chọn thư viện .xlsx

### So sánh

| Tiêu chí | **exceljs** | SheetJS (`xlsx`) |
|---|---|---|
| Native addon | **KHÔNG** (pure JS) → không đụng `@electron/rebuild` như better-sqlite3 | KHÔNG (pure JS) |
| Đọc .xlsx | Có (kèm `WorkbookReader` streaming theo dòng) | Có, rất nhanh |
| Ghi .xlsx | Có + **style/định dạng/cột/freeze/data-validation dropdown** (cần cho MẪU TRỐNG có sheet hướng dẫn) | Ghi được; **style/validation bị khóa ở bản free** (chỉ bản Pro) |
| Bundle size | Lớn hơn (~1MB + `fast-csv`/zip deps) | Core nhỏ hơn |
| Phân phối npm | `exceljs` chính chủ trên npm, MIT, còn maintain | npm `xlsx@0.18.5` đã **cũ/deprecated**; bản mới chỉ self-host CDN → ma sát cài đặt + lịch sử CVE prototype-pollution ở bản cũ |
| Externalize | Dùng dynamic require (zip) → **nên external** giống `electron-updater`/`pg` | Tương tự |
| Streaming để chống OOM | `stream.xlsx.WorkbookReader` (đọc từng row) | Đọc full-in-memory là chính |

### QUYẾT ĐỊNH (đề xuất, chờ Mr.Long chốt)
**Chọn `exceljs`.** Lý do:
1. **Pure-JS, không native** → không rủi ro rebuild/asar-unpack native như từng lo với better-sqlite3; bundle packaged an toàn.
2. **Đủ sức tạo MẪU TRỐNG chuẩn**: nhiều sheet (Dữ liệu + Hướng dẫn), header in đậm/freeze, **data-validation dropdown** cho cột enum (vd `status` POS), format số/ngày, chú thích ô — SheetJS free không làm được.
3. **Streaming reader** cho phép áp trần dòng & chống OOM khi import.
4. Phân phối npm rõ ràng, MIT, tránh ma sát + lịch sử bảo mật của gói `xlsx` cũ.
5. Đọc + ghi **cùng 1 thư viện** → ít bề mặt phụ thuộc.

**Nguyên tắc kiến trúc bắt buộc:** MỌI thao tác parse/generate .xlsx chạy ở **MAIN process**, KHÔNG ở renderer. Renderer chỉ (a) đưa abs path file cần đọc, (b) đưa headers+rows cần ghi, (c) nhận kết quả. Lý do: giữ lib nặng ngoài bundle renderer/CSP, tận dụng `fs`+`dialog` sẵn ở main, đồng nhất với luồng đính kèm hiện có (renderer đưa path, main đọc).

**Cấu hình bundle (đề xuất — CMD THỰC THI sẽ sửa `electron.vite.config.ts`, KHÔNG sửa trong phase design này):** thêm `'exceljs'` vào `mainExternals`, nạp bằng `await import('exceljs')` trong service main (như `update-service.ts:282`), khai `exceljs` là `dependency` (không `devDependency`) + đảm bảo `electron-builder.yml` đưa vào `node_modules` gói (không asar-strip).

---

## 2. Thiết kế XUẤT .xlsx thật (thay CSV)

### 2.1 Giữ nguyên API 16 call site
`lib/exportCsv.ts` được thay bằng `lib/exportXlsx.ts` **cùng chữ ký** để 16 trang không phải sửa logic dựng dữ liệu:

```ts
// HỢP ĐỒNG ĐỀ XUẤT (renderer)
export async function exportXlsx(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  opts?: { sheetName?: string; purpose?: ExportPurpose }  // purpose → nhớ folder riêng nếu cần
): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
```
- Gọi `window.api.exportXlsx({ filename, headers, rows, sheetName })` → IPC main.
- **Đề xuất chuyển tiếp mượt:** giữ `exportCsv` như alias mỏng gọi `exportXlsx` (hoặc đổi tên đồng loạt 16 nhãn "Xuất Excel" — vốn đã ghi "Xuất Excel" chứ không phải "Xuất CSV"). → 1 dòng CẦN CHỐT.

### 2.2 IPC + main service
```ts
// HỢP ĐỒNG ĐỀ XUẤT — main/xlsx-service.ts (mới)
ipcMain.handle('file:exportXlsx', (_e, a: {
  filename: string; headers: string[];
  rows: (string|number|null)[][]; sheetName?: string; purpose?: string;
}) => xlsxSvc.exportWorkbook(a));
```
Luồng `exportWorkbook`:
1. `dialog.showSaveDialog(win, { defaultPath: join(rememberDir(purpose), safe(filename)+'.xlsx'), filters:[{name:'Excel',extensions:['xlsx']}] })`.
2. Nếu `canceled` → `{ok:false,canceled:true}`.
3. Dựng `Workbook` (exceljs), 1 worksheet, header row in đậm + freeze row 1, autofilter; ghi rows; **chống formula-injection**: ô text bắt đầu `= + - @` → prefix `'` (áp cho CẢ xuất, không chỉ nhập).
4. `workbook.xlsx.writeFile(chosenPath)`.
5. **Nhớ folder**: lưu `dirname(chosenPath)` (xem 2.3).
6. Trả `{ok:true, path}`. Renderer toast "Đã xuất: <path>".

> Vì sao ghi ở main bằng `showSaveDialog` thay vì `a.download` như CSV: (a) người dùng chọn ĐÚNG nơi lưu + đặt tên; (b) nhớ folder lần sau; (c) tránh giới hạn/rủi ro của Blob lớn trong renderer.

### 2.3 NHỚ folder lần trước (per-máy, KHÔNG vào DB)
Ghi vào `<userData>/export-prefs.json` (đúng pattern `server-config.json`/`update-result.json`, `db.ts:41`):
```jsonc
{ "lastExportDir": "D:/BaoCao", "lastImportDir": "D:/Nhap", "lastTemplateDir": "D:/Mau" }
```
- `rememberDir(purpose)`: đọc file → nếu `existsSync(dir)` trả dir, ngược lại fallback `app.getPath('documents')`.
- Sau mỗi save/open thành công → cập nhật key tương ứng.
- **KHÔNG dùng `appSetting`** (đó là cấu hình dùng chung toàn server, gate quyền) — folder là chuyện riêng từng máy client.
- → 1 dòng CẦN CHỐT: 1 folder chung hay tách folder theo mục đích (xuất / nhập / tải mẫu). Đề xuất: tách 3 key như trên.

---

## 3. MẪU TRỐNG (.xlsx template)

### 3.1 Cấu trúc file mẫu (mỗi thực thể 1 mẫu)
- **Sheet 1 "Dữ liệu"**: đúng các cột của thực thể, header đậm + freeze; cột enum (vd `status` POS) gắn **data-validation dropdown**; cột số/ngày định dạng sẵn; 1 dòng ví dụ mờ (sẽ bị bỏ khi import nếu trùng marker mẫu).
- **Sheet 2 "Hướng dẫn"**: bảng mô tả từng cột — Tên cột | Kiểu dữ liệu | Bắt buộc? | Ràng buộc/ví dụ | Ghi chú (unique, enum values, định dạng ngày `dd/mm/yyyy`).
- **Hàng khóa cột (ẩn/đóng băng):** để ánh xạ cột ổn định (xem §5 encoding), mẫu nên có **key kỹ thuật** cho mỗi cột (vd comment ô header hoặc 1 hàng ẩn chứa `serial|model|bank|status|warehouseLoc|note`), không phụ thuộc nhãn tiếng Việt có dấu.

### 3.2 POS trước (mẫu #1 = `PosDevice`)
| Cột (nhãn) | key | Kiểu | Bắt buộc | Ràng buộc |
|---|---|---|---|---|
| Serial | `serial` | text | ✔ | unique toàn hệ; trim |
| Chủng loại | `model` | text | – | |
| Ngân hàng | `bank` | text | – | |
| Trạng thái | `status` | enum | – | IN_STOCK/DEPLOYED/IN_REPAIR/DAMAGED/RETIRED (dropdown), rỗng→IN_STOCK |
| Vị trí kho | `warehouseLoc` | text | – | |
| Ghi chú | `note` | text | – | |

> `PosDevice` KHÔNG sinh mã (serial là danh tính) → mẫu đơn giản nhất, hợp "POS trước". **CẦN CHỐT:** thực thể đáng import hàng loạt THẬT có thể là `PosIntake` (nhập lô máy mua về: serial+chủng loại+NCC+giá+ngày) — hỏi Mr.Long J2 nhắm `PosDevice` hay `PosIntake` trước.

### 3.3 IPC tải mẫu
```ts
ipcMain.handle('file:downloadTemplate', (_e, a:{ entity: EntityKey }) => xlsxSvc.buildTemplate(a.entity));
// showSaveDialog(defaultPath = rememberDir('template')/'MAU_<entity>.xlsx') → ghi workbook mẫu.
```

---

## 4. NHẬP (import)

### 4.1 Luồng tổng
```
Chọn/kéo-thả file .xlsx  →  main đọc (streaming, có trần)  →  MAP cột theo key
   →  VALIDATE TỪNG DÒNG (dry-run, gom lỗi 'Dòng N: lý do')
   →  nếu có lỗi & chính sách all-or-nothing → BÁO CÁO, KHÔNG ghi
   →  nếu hợp lệ → $transaction tạo hàng loạt (nextCode trong tx nếu cần) + writeAudit
   →  trả { created, skipped, errors[] }
```

### 4.2 Hợp đồng IPC + service
```ts
// HỢP ĐỒNG ĐỀ XUẤT
ipcMain.handle('import:parse',   (_e,a:{entity:EntityKey; srcPath:string}) => importSvc.parseAndValidate(a)); // dry-run
ipcMain.handle('import:commit',  (_e,a:{entity:EntityKey; srcPath:string; onDup:DupPolicy}) => importSvc.commit(a));

interface RowError { row: number; column?: string; reason: string }
interface ParseResult {
  ok: boolean;
  total: number;
  valid: number;
  errors: RowError[];          // 'Dòng 12: Serial trùng "POS007"'
  preview: Record<string,unknown>[];  // vài dòng đầu để user xem trước
}
type DupPolicy = 'error' | 'skip' | 'update';
```
- **2 bước rõ ràng**: `import:parse` (chỉ đọc+validate, hiện bảng lỗi) → user xác nhận → `import:commit`. Không commit ngầm.
- `commit` mở **1 `$transaction`** tạo toàn bộ dòng hợp lệ; per-entity dùng service create hiện có làm nguồn chân lý ràng buộc (vd `createPos`, `createCustomer`) — hoặc rẽ nhánh tx-aware để gộp atomic (`nextCode(prefix, tx)`).

### 4.3 Phản biện + CHỐT các quyết định import
| Vấn đề | Lựa chọn | Đề xuất KTS |
|---|---|---|
| Bỏ dòng lỗi vs all-or-nothing | (a) all-or-nothing (b) commit dòng đúng, bỏ dòng sai | **all-or-nothing** SAU khi `import:parse` đã liệt kê hết lỗi cho user sửa. Lý do: dữ liệu tài chính/tài sản, nửa vời khó truy vết; user sửa file rồi nhập lại. (skip là tùy chọn bật riêng.) |
| Trùng mã/serial | error / skip / update | **error mặc định** (báo 'Dòng N: trùng'); cho phép chọn `skip`. **KHÔNG** `update` mặc định (import không nên âm thầm sửa bản ghi hiện có — vi phạm R_AUDIT khó lần). |
| Tham chiếu sai (chủng loại/NCC/đối tác/bank/nguồn chưa có) | báo lỗi vs auto-tạo | **BÁO LỖI** 'Dòng N: Chủng loại "X" không tồn tại'. KHÔNG auto-tạo master data từ import. Cho nhập bằng **mã** (code) hoặc tên — resolve về id ở main. |
| Sinh mã tự động (nextCode) vs mã trong file | | **Bỏ qua mọi cột mã trong file, LUÔN `nextCode`** cho thực thể có mã sinh (Customer KH##). Cột mã (nếu có) chỉ để tham chiếu người đọc. Với `PosDevice`/`PosIntake`/`Tid` — khóa tự nhiên (serial/tid) LẤY TỪ FILE (bắt buộc, unique). |
| Quyền import | reuse vs perm mới | Thêm quyền **`*_IMPORT`** riêng (vd `POS_IMPORT`,`CUSTOMER_IMPORT`,`TID_IMPORT`,`CONFIG_POS_SUPPLY_IMPORT`) HOẶC gate bằng `*_CREATE`/`*_MANAGE` sẵn có + `ASSET_EXPORT` cho xuất POS/TID (đã có `ASSET_EXPORT`/`ASSET_EXPORTED`). Đề xuất: **import gate bằng quyền CREATE/MANAGE tương ứng** (import = tạo hàng loạt) → không phình permission; nhưng ghi audit action mới `*_IMPORTED`. → CHỐT. |
| Giới hạn số dòng | | **Trần MAX_IMPORT_ROWS** (đề xuất 5.000) + trần kích thước file (đề xuất 10MB). Quá → từ chối sớm 'File vượt N dòng'. |
| Encoding | | .xlsx là XML/UTF-8 native → tiếng Việt an toàn (không cần BOM như CSV). Rủi ro ở **khớp tên cột** → khớp theo key kỹ thuật/thứ tự cột, chuẩn hóa (trim + bỏ dấu + lowercase) khi khớp theo nhãn. |

### 4.4 Audit
Mỗi commit ghi `writeAudit(action:'<ENTITY>_IMPORTED', targetType, after:{count, fileName})` — cần thêm action type vào `packages/shared/src/types.ts` (CMD THỰC THI, không trong design này).

---

## 5. Component vùng KÉO-THẢ dùng chung (`DropZone`)

### 5.1 Mục tiêu tái dùng
Một component áp cho **cả** (a) import Excel, (b) đính kèm CCCD/ĐKKD/chứng từ — thay/bổ sung nút "Chọn ảnh" của `AttachField`.

### 5.2 Hợp đồng (renderer)
```ts
// HỢP ĐỒNG ĐỀ XUẤT — components/DropZone.tsx (mới)
interface DropZoneProps {
  accept: ('png'|'jpg'|'jpeg'|'pdf'|'xlsx')[];
  maxSizeMB: number;                 // vd 10 (ảnh) / 10 (xlsx)
  onFile: (absPath: string, meta:{ name:string; size:number; ext:string }) => void;
  onReject: (reason: string) => void; // → toast.alert (1 dialog lỗi TO-RÕ, R_UI_STANDARD)
  hint?: string;                      // "Kéo thả hoặc bấm chọn"
}
```
- Hỗ trợ **cả** click (mở `file:pickImage`-style dialog) **và** kéo-thả.
- Validate **loại** (theo `accept`) + **kích thước** (`maxSizeMB`) NGAY ở renderer trước khi gửi main (fail nhanh), main validate lại (defense-in-depth).

### 5.3 Lấy abs path của file kéo-thả — RỦI RO Electron 33
Electron ≥32 **đã bỏ `File.path`**. Để lấy đường dẫn tuyệt đối của file kéo-thả (main mới đọc được như luồng đính kèm hiện tại), phải dùng **`webUtils.getPathForFile(file)`** — hàm này chỉ gọi được ở process có `webUtils` (preload) → **phải expose thêm 1 API preload** (`getPathForFile`). Vì task cấm sửa preload trong phase design → đây là **CẦN CHỐT** (mục 8) + được duyệt trước khi dựng J3.
- Phương án B (không cần path): renderer đọc `File` → `ArrayBuffer` → gửi bytes qua IPC cho main parse. Nhược: nhân đôi bộ nhớ + IPC payload lớn với file to → mâu thuẫn chống-OOM. → Ưu tiên phương án `getPathForFile` (streaming từ disk ở main).

### 5.4 Wiring
- `AttachField` (Attach.tsx) bọc `DropZone accept={['png','jpg','jpeg','pdf']}` giữ nguyên `onPick(absPath)`.
- Màn Import (mỗi trang danh sách) đặt `DropZone accept={['xlsx']}` → `onFile` gọi `import:parse`.

---

## 6. Kế hoạch PHA (build tuần tự — R_SUPREME workflow, Tier N+1 khóa tới khi N tag)

### J1 — XUẤT .xlsx thật + nhớ folder
- `main/xlsx-service.ts` (`exportWorkbook`) + IPC `file:exportXlsx`; preload `exportXlsx`; `lib/exportXlsx.ts` giữ chữ ký; `export-prefs.json` (`rememberDir`); thêm `exceljs` external.
- Đổi 16 nút "Xuất Excel" sang `exportXlsx` (hoặc alias).
- **Gate/selftest** `GLB_SELFTEST=<n1>`: dựng workbook từ rows mẫu (có ký tự có dấu + ô bắt đầu `=`) → `writeFile` tạm → đọc lại bằng exceljs → assert số ô, giá trị, prefix chống-formula; roundtrip `export-prefs.json` (ghi→đọc→folder không tồn tại→fallback documents).

### J2 — MẪU TRỐNG + import POS + validate
- `buildTemplate('pos')` + IPC `file:downloadTemplate`; `main/import-service.ts` (`parseAndValidate`/`commit`) cho `PosDevice`; UI import ở `PosPage`.
- **Gate/selftest** `GLB_SELFTEST=<n2>` (GLB_ROLE=server, GLB_DB_URL tạm):
  - file HỢP LỆ N dòng → `parse` valid=N, `commit` created=N, DB đếm khớp.
  - file LỖI: thiếu serial / serial trùng / status sai enum / vượt trần dòng → `errors[]` đúng 'Dòng N: lý do', `commit` bị chặn (all-or-nothing).
  - dup policy `skip` → created=hợp lệ, skipped=trùng.
  - file .xlsx rỗng / sai sheet / không phải xlsx (đổi đuôi) → lỗi rõ, không crash.

### J3 — DropZone dùng chung
- `components/DropZone.tsx`; expose preload `getPathForFile` (**sau khi Mr.Long duyệt sửa preload**); wire vào `AttachField` + màn import.
- **Gate/selftest**: unit validate loại/size (renderer, pure fn tách ra `lib/`); thủ công kéo-thả ảnh + xlsx (Production Validation, R196).

### J4 — Mở rộng thực thể
- Mẫu + import cho `Customer` (nextCode KH##, bỏ cột mã), `PosIntake` (resolve NCC/chủng loại/trạng thái theo mã/tên), `Tid` (resolve bank/partner/nguồn…).
- **Gate/selftest** `GLB_SELFTEST=<n3+>`: mỗi thực thể lặp bộ ca hợp lệ/lỗi/ref-sai/nextCode.

> Mỗi pha: Build → Unit/Selftest → Regression → **Production Validation (Mr.Long nhập file thật + accept)** → Freeze → Git tag → mới sang pha sau. Cập nhật `VERSION.md` + `BUGS_FIXED.md` mỗi fix.

---

## 7. RỦI RO (≥6) + giảm thiểu

| # | Rủi ro | Hệ quả | Giảm thiểu |
|---|---|---|---|
| R1 | **File lớn / OOM** — xlsx 50MB, hàng triệu dòng nạp full vào main | main crash, treo app | Trần kích thước (10MB) + trần dòng (5.000) từ chối SỚM; dùng `stream.xlsx.WorkbookReader` đọc từng row; đọc ở main (không nhân đôi qua renderer) |
| R2 | **.xlsx độc hại** — zip-bomb, formula injection (`=cmd\|…`), ô công thức | máy chậm/hỏng, lệnh chạy khi mở file xuất | exceljs không eval công thức; coi mọi ô là value/text; **xuất**: prefix `'` cho ô bắt đầu `= + - @`; giới hạn kích thước giải nén; chỉ nhận `.xlsx` thực (kiểm magic/OpenXML, không chỉ đuôi) |
| R3 | **Dòng lỗi giữa chừng / rollback** | DB ghi nửa vời, khó truy vết | **Dry-run validate toàn bộ trước**; commit trong **1 `$transaction`** all-or-nothing; lỗi bất kỳ → rollback sạch, báo per-row |
| R4 | **Mã/serial trùng khi import song song** (2 client) | 1 client P2002 giữa chừng | Dựa **unique constraint DB trong tx** (bắt P2002 → 'Dòng N: trùng'), KHÔNG chỉ pre-check (TOCTOU); `nextCode` vốn atomic; giữ tx ngắn, validate ngoài tx |
| R5 | **Folder nhớ không tồn tại** (USB rút, thư mục bị xóa) | showSaveDialog lỗi/ diễn giải sai | `existsSync(dir)` trước khi set `defaultPath`; fallback `app.getPath('documents')`; showSaveDialog vẫn là chốt cuối |
| R6 | **Bundle/externalize `exceljs`** sai (như cảnh báo electron-updater) | packaged app vỡ resolve, chạy dev OK nhưng .exe lỗi | Thêm vào `mainExternals` + `await import('exceljs')` bọc try/catch; khai `dependency`; verify trên **build đóng gói** (không chỉ dev); electron-builder giữ trong node_modules |
| R7 | **Khớp cột tiếng Việt có dấu** — user đổi nhãn/thứ tự cột | map sai cột → dữ liệu lệch | Khớp theo **key kỹ thuật** (hàng ẩn/comment) hoặc thứ tự cột cố định của mẫu; khớp nhãn thì chuẩn hóa (trim+bỏ dấu+lowercase); từ chối nếu thiếu cột bắt buộc |
| R8 | **Electron 33 bỏ `File.path`** cho kéo-thả | không lấy được abs path → import/đính kèm kéo-thả hỏng | Dùng `webUtils.getPathForFile` (cần expose preload — CẦN CHỐT); phương án dự phòng gửi ArrayBuffer (chấp nhận trade-off bộ nhớ cho file nhỏ) |

---

## 8. CẦN MR.LONG CHỐT

1. **Thư viện**: duyệt `exceljs` (đề xuất) hay `SheetJS`?
2. **Thực thể import đầu (J2)**: `PosDevice` (đơn giản, "POS trước") hay `PosIntake` (nhập lô máy — sát nhu cầu bulk thật)?
3. **Chính sách trùng mã/serial**: `error` mặc định + cho bật `skip`? Có cho `update` không (đề xuất KHÔNG)?
4. **All-or-nothing** (đề xuất) vs cho phép bỏ dòng lỗi?
5. **Tham chiếu master data** trong file: nhập bằng **mã (code)** hay **tên**? (đề xuất: mã, fallback tên; KHÔNG auto-tạo)
6. **Quyền import**: thêm `*_IMPORT` riêng hay dùng quyền `CREATE/MANAGE` sẵn có + audit `*_IMPORTED`? (đề xuất: dùng sẵn có + action mới)
7. **Trần**: MAX_IMPORT_ROWS = 5.000? file ≤ 10MB? (số cụ thể)
8. **Nhớ folder**: 1 folder chung hay tách 3 (xuất/nhập/mẫu)? Lưu `<userData>/export-prefs.json` (đề xuất) — xác nhận KHÔNG dùng `appSetting`.
9. **Xuất**: giữ renderer đưa rows (tái dùng 16 call site) hay chuyển main tự truy vấn DB? (đề xuất: giữ rows-từ-renderer để không đụng logic 16 trang)
10. **Duyệt sửa `preload`/`schema`/`config`** ở phase thực thi: expose `getPathForFile` + IPC mới (`file:exportXlsx`,`file:downloadTemplate`,`import:parse`,`import:commit`) + thêm action `*_IMPORTED` vào `types.ts` + thêm `exceljs` external. (Design phase này KHÔNG đụng.)
11. **Đổi nhãn nút**: 16 nút đang ghi "Xuất Excel" nhưng ra .csv — sau J1 ra .xlsx thật; giữ nhãn "Xuất Excel" (đúng nghĩa hơn) — xác nhận.
