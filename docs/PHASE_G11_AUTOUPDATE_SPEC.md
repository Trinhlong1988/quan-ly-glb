# PHASE G11 — Cập nhật phần mềm tích hợp trong app (electron-updater qua LAN)

> Mở lại hạng mục hoãn **D01** (xem `DEFERRED_REGISTRY.md`). Mr.Long chốt luồng 10/7.
> **Nguyên tắc phản biện (ghi sẵn để CMD_BUILD không vấp):** Windows KHÔNG thay được file .exe đang chạy → bản mới **áp dụng khi khởi động lại**. Vì vậy luồng đúng = tải xong → thoát → cài → mở lại. Không có "thay nóng khi đang chạy".

## 1. Luồng UX Mr.Long chốt (ĐÚNG 5 bước — cấm thêm/bớt)
1. App (đang chạy/đăng nhập) **định kỳ + lúc mở** hỏi server có bản mới không.
2. Có bản mới → **push thông báo nổi**: *"Hệ thống có bản cập nhật mới (vX.Y.Z). [Cập nhật ngay] [Để sau]"*. (Dùng hạ tầng thông báo/toast sẵn có; KHÔNG dựng chuông mới.)
3. User bấm **Cập nhật ngay** → **thanh loading %** "Đang tải bản cập nhật…". (Bấm *Để sau* → đóng banner, lần mở/kỳ kiểm tra sau nhắc lại.)
4. Tải xong → app **tự thoát** (đăng xuất phiên) → **cài im lặng** (perUser, không cần admin).
5. Cài xong → app **tự mở lại** vào **bản mới** → dừng ở **màn đăng nhập** → user đăng nhập → thấy giao diện/chức năng mới.
6. **Sau khi mở lại (bản mới)** → hiện **thông báo thành công RÕ RÀNG**: *"✅ Đã cập nhật thành công lên phiên bản vX.Y.Z — lúc dd/mm/yyyy HH:mm"*. (Đọc từ marker lưu trước lúc cài; hiện 1 lần rồi xoá marker.)
7. **Nếu cập nhật LỖI** (tải lỗi/cài lỗi/mất kết nối giữa chừng) → banner đỏ rõ: *"❌ Cập nhật thất bại: &lt;lý do cụ thể&gt;"* + nút **[Cập nhật lại]** (thử lại từ đầu: check → download). Không để user mắc kẹt, không mất bản đang chạy.

### Marker báo kết quả (cơ chế — đã vá H4/M6)
- Trước `quitAndInstall`: ghi `userData/update-result.json` = `{ targetVersion, fromVersion, startedAt }`.
- Lần khởi động kế, `evalMarker(app.getVersion())`:
  - **JSON hỏng/rỗng/không đọc được → coi `none`, KHÔNG throw** (M6, bọc try/catch).
  - `version === targetVersion` → kết quả `success {version, at}` (bước 6).
  - `version !== targetVersion` (cài hỏng, vẫn bản cũ) → kết quả `failed {fromVersion, targetVersion}` (bước 7 + [Cập nhật lại]).
- **[H4] XOÁ marker NGAY sau khi đánh giá — ở CẢ hai nhánh success VÀ failed** (chỉ báo 1 lần). Không xoá ở nhánh failed = báo lỗi đỏ **vô hạn mỗi lần mở app**.
- Renderer lấy kết quả qua `invoke('update:getBootResult')` lúc mount (pull, chống race — H2), không phải nghe push.

## 2. Kỹ thuật
- **Dependency:** thêm `electron-updater` là **dependency trực tiếp** của `apps/desktop` (hiện chỉ transitive).
- **Cấu hình phát hành** (`electron-builder.yml`): thêm
  ```yaml
  publish:
    provider: generic
    url: http://192.168.1.6:8686/updates/
    channel: latest
  ```
  Giữ `nsis.perMachine: false` (cài theo user → cập nhật im lặng KHÔNG cần UAC). `oneClick`: để `false` cho lần cài tay đầu; `quitAndInstall(true,…)` truyền `/S` nên tự cập nhật vẫn im.
  - **[M1] artifactName ASCII:** `productName="Quản Lý GLB"` có dấu+space → tên file feed phi-ASCII dễ gãy khi electron-updater tải qua HTTP. Đặt `artifactName: glb-${version}-setup.${ext}` (ASCII), giữ `productName` để hiển thị. `latest.yml` sẽ tham chiếu tên ASCII.
  - **[M2] Version đóng gói = `apps/desktop/package.json`** (hiện `0.1.0`), KHÁC root `0.1.0-phaseA`. `app.getVersion()` + electron-builder đọc file này → **quy trình phát hành bump `apps/desktop/package.json`**, không phải root, nếu không feed không thấy bản mới.
- **Main** `apps/desktop/src/main/update-service.ts` (MỚI):
  - `autoUpdater.autoDownload = false` (chờ user bấm — đúng bước 3). `autoUpdater.autoInstallOnAppQuit = true`.
  - Chỉ chạy khi **app đã đóng gói** (`app.isPackaged`) — dev bỏ qua, không crash (dev-guard).
  - Kiểm tra: lúc `ready` + `setInterval` mỗi 60 phút (`checkForUpdates()`), **bọc try/catch** — server không với tới thì **im lặng, app vẫn chạy bình thường** (KHÔNG popup lỗi, KHÔNG crash).
  - **[H2] Tham chiếu cửa sổ:** `index.ts` PHẢI lưu ref `mainWindow` (hiện `win` cục bộ trong `createWindow` — không gửi được). update-service dùng ref đó để `webContents.send`. Kiểm null (cửa sổ có thể chưa/đã đóng).
  - Sự kiện realtime → `mainWindow.webContents.send`: `update-available {version}` · `download-progress {percent}` · `update-downloaded {version}` · `update-error {message}`.
  - **[H2 chống race] Trạng thái BOOT (success/failed) KHÔNG push** (renderer chưa mount → rơi). Thay vào đó: đánh giá marker lúc khởi động, lưu vào biến; renderer **CHỦ ĐỘNG gọi `invoke('update:getBootResult')`** khi mount → trả `{kind:'success', version, at}` | `{kind:'failed', fromVersion, targetVersion}` | `null`. Lấy xong → đánh dấu đã-tiêu-thụ.
  - IPC nhận từ renderer: `update:check` → `checkForUpdates()` (nút **Cập nhật lại**); `update:start` → `autoUpdater.downloadUpdate()` (**[M4] chặn gọi trùng: cờ `isDownloading`, đang tải thì bỏ qua**); `update:installNow` → **[M5] cảnh báo "hãy lưu công việc, app sẽ đóng để cài"** rồi ghi marker rồi `autoUpdater.quitAndInstall(true, true)` **([H1] isSilent=true, forceRunAfter=true — combo cài IM + tự mở lại; `(false,true)` là SAI vì bung wizard NSIS)**.
  - **[H3] Tách pure-unit để test thật:** export riêng (không phụ thuộc packaged/mạng): `isNewer(cur, next)` (semver, 0.1.10>0.1.9), `readMarker()/writeMarker()/evalMarker(curVersion)` (→ success|failed|none, **[M6] JSON hỏng/rỗng → coi none, KHÔNG throw**), và cho **inject `autoUpdater`** (tham số/DI) để mock ca lỗi/tải/retry. `startUpdater(deps)` nhận updater + window để selftest bơm giả.
  - **Xử lý lỗi:** mọi `error`/tải hỏng → `update-error {message}` lý do người-đọc-được (mất kết nối / hết dung lượng / file hỏng), KHÔNG throw ra ngoài. Sau lỗi cờ `isDownloading=false` để **[M4/f] retry** được.
- **Renderer:**
  - Banner/toast "có bản mới" (dùng toast/hệ thống thông báo hiện có) + nút **Cập nhật ngay / Để sau**.
  - Modal/thanh tiến trình khi tải (nghe `download-progress`).
  - `update-downloaded` → gọi `update:installNow` (tự động, hoặc nút "Khởi động lại để hoàn tất" tuỳ bước 4 — theo Mr.Long = tự thoát nên gọi luôn).
  - **Hiển thị phiên bản hiện tại** (đáp yêu cầu "cập nhật hệ thống nằm đâu"): footer Dashboard + trang Cấu hình/Giới thiệu ghi `vX.Y.Z` (từ `app.getVersion()` qua IPC `app:getVersion`). Đây là chỗ "trực quan" user thấy đã lên bản mới.
- **preload/index.d.ts** (FILE BẢO VỆ — chỉ Edit chèn): thêm DTO + method `onUpdateAvailable/onDownloadProgress/onUpdateDownloaded/onUpdateError`, `startUpdate()`, `installUpdateNow()`, `getAppVersion()`.

## 3. Hạ tầng server cập nhật (LEAD dựng — KHÔNG phải việc CMD_BUILD)
- Thư mục `D:\glb-updates\` trên máy chủ `192.168.1.6`, chứa `latest.yml` + `*-setup.exe` + `*.blockmap` (electron-builder sinh ra khi `--publish`).
- Dịch vụ **HTTP tĩnh** nghe cổng **8686** phục vụ thư mục đó (chạy nền, mở firewall LAN 192.168.1.0/24). LEAD dựng + mở port sau khi Mr.Long duyệt (đụng hạ tầng — R2).
- **Quy trình phát hành về sau:** LEAD bump version → `npm run build` + electron-builder `--publish always` (hoặc copy tay `dist/latest.yml`+exe+blockmap vào `D:\glb-updates\`) → mọi máy client tự nhận ở lần kiểm tra kế.
- **Rollback:** giữ exe bản-tốt-gần-nhất; nếu bản mới lỗi → sửa `latest.yml` trỏ lại + bump version cao hơn (electron-updater không tự hạ cấp).
- **[M7] An ninh (rủi ro CHẤP NHẬN CÓ CHỦ ĐÍCH — Mr.Long biết):** feed HTTP nội bộ không auth + exe **chưa ký số** (D02) → kẻ trong LAN đẩy `latest.yml`+exe giả lên 8686 = chạy mã tùy ý trên mọi client ở update kế. electron-updater verify sha512 nhưng chính latest.yml lấy qua HTTP không xác thực. Giảm thiểu tối thiểu: **chỉ LEAD có quyền ghi `D:\glb-updates\`** (ACL), firewall chỉ LAN 192.168.1.0/24. Nâng cấp thật = HTTPS + ký số (D02) khi phát hành ngoài LAN.

## 4. Bất biến / phản biện (gate phòng ngừa — CMD_BUILD phải thoả)
- `offline-safe`: server cập nhật **không với tới** → `checkForUpdates` nuốt lỗi, **app vẫn khởi động + đăng nhập + dùng bình thường**, không popup đỏ. **Gate bắt buộc** (đây là rủi ro cao nhất: đừng để cơ chế update làm chết app khi mất mạng/server tắt).
- `dev-guard`: `!app.isPackaged` → không gọi updater (tránh crash khi chạy dev/selftest).
- `no-auto-without-consent`: KHÔNG tự tải khi user chưa bấm (autoDownload=false) — đúng bước "push + xác nhận".
- `emit-trap`: verify LUÔN `npm run typecheck` (--noEmit); git sạch.
- `type-mirror-drift`: sửa `preload/index.d.ts` → web typecheck 0 + `audit:protected` PASS (chỉ Edit chèn).
- `ui-consistency`: banner + progress dùng token design system + toast chuẩn; không dựng chuông/panel mới.
- **[M6] marker-corrupt-safe:** `update-result.json` hỏng/rỗng lúc boot → coi none, KHÔNG crash khởi động.
- **[M4] no-double-download:** đang tải (`isDownloading`) → bấm lại "Cập nhật ngay" bị bỏ qua/disable, không gọi `downloadUpdate` 2 lần.
- **[M8] listener-cleanup:** renderer đăng ký `ipcRenderer.on` phải `removeListener` khi unmount (return cleanup trong useEffect) → tránh banner nhân đôi/leak.
- **[M5] no-data-loss:** trước `quitAndInstall` cảnh báo "hãy lưu công việc, app sẽ đóng để cài".
- **[L1] externalize:** `electron-updater` phải externalize (không bundle — dùng dynamic require); verify tương thích electron 33 (updater 6.x) sau `npm install`.

## 5. Bằng chứng (AUDIT rerun sạch)
- `npm run typecheck`=0 · `npm run build`=0 · `npm test`≥205.
- **selftest MỚI =23 (update wiring)** — phải test **pure-unit + autoUpdater MOCK bơm vào** (H3), KHÔNG cần app đóng gói/mạng (miễn ca sẽ thành test giả):
  - (a) test-được-trực-tiếp: `startUpdater` với `app.isPackaged=false` → updater KHÔNG khởi động (dev-guard).
  - (b) `isNewer('0.1.9','0.1.10')`=true, `isNewer('0.1.0','0.1.0')`=false (semver, KHÔNG so chuỗi).
  - (c) MOCK: updater.checkForUpdates ném lỗi → handler nuốt, `startUpdater` KHÔNG throw (offline-safe).
  - (d) MOCK: bắn `update-downloaded` → ghi marker đúng + `installNow` gọi `quitAndInstall(true,true)` đúng **1 lần**.
  - (e) `evalMarker`: version khớp target → `success`+**xoá marker**; không khớp → `failed`+**xoá marker** (H4); JSON hỏng → `none` không throw (M6).
  - (f) MOCK: sau `update-error`, `isDownloading=false` → `update:start` gọi lại được (retry, không kẹt); gọi `start` khi đang tải → bỏ qua (M4).
  - **[M3] index.ts miễn DB cho selftest=23** (không đụng Postgres) — thêm '23' vào danh sách miễn trừ `GLB_DB_URL`/`GLB_ROLE`, nếu không `app.exit(2)` trước khi test chạy.
  - `audit:protected` PASS · git sạch.
- **E2E tay (LEAD nghiệm thu R196):** build v hiện tại cài máy → đặt v cao hơn lên feed → mở app → thấy banner → bấm Cập nhật → tải → thoát → mở lại đúng version mới → footer hiện version mới. (Ghi checklist, Mr.Long xem.)
