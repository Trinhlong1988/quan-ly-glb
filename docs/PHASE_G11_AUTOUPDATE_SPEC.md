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

### Marker báo thành công (cơ chế)
- Trước `quitAndInstall`: ghi `userData/update-result.json` = `{ targetVersion, startedAt }`.
- Lần khởi động kế: nếu `app.getVersion() === targetVersion` → đẩy renderer `update-success {version, at}` → hiện thông báo bước 6 → **xoá file**. Nếu version KHÔNG khớp (cài hỏng, vẫn version cũ) → coi như lỗi → `update-failed {fromVersion, targetVersion}` → banner bước 7 + [Cập nhật lại].

## 2. Kỹ thuật
- **Dependency:** thêm `electron-updater` là **dependency trực tiếp** của `apps/desktop` (hiện chỉ transitive).
- **Cấu hình phát hành** (`electron-builder.yml`): thêm
  ```yaml
  publish:
    provider: generic
    url: http://192.168.1.6:8686/updates/
    channel: latest
  ```
  Giữ `nsis.perMachine: false` (cài theo user → cập nhật im lặng KHÔNG cần UAC). `oneClick`: để `false` cho lần cài tay đầu (có wizard); electron-updater vẫn cài im (`/S`) khi tự cập nhật.
- **Main** `apps/desktop/src/main/update-service.ts` (MỚI):
  - `autoUpdater.autoDownload = false` (chờ user bấm — đúng bước 3).
  - `autoUpdater.autoInstallOnAppQuit = true`.
  - Chỉ chạy khi **app đã đóng gói** (`app.isPackaged`) — dev bỏ qua, không crash.
  - Kiểm tra: lúc `ready` + `setInterval` mỗi 60 phút (`checkForUpdates()`), **bọc try/catch** — server không với tới thì **im lặng, app vẫn chạy bình thường** (KHÔNG popup lỗi, KHÔNG crash).
  - Sự kiện → đẩy IPC lên renderer: `update-available {version}` · `download-progress {percent}` · `update-downloaded {version}` · `update-error {message}` · (lúc boot) `update-success {version, at}` / `update-failed {fromVersion, targetVersion}`.
  - IPC nhận từ renderer: `update:check` → `checkForUpdates()` (dùng cho nút **Cập nhật lại**); `update:start` → `autoUpdater.downloadUpdate()`; `update:installNow` → ghi marker rồi `autoUpdater.quitAndInstall(false, true)` (thoát+cài+mở lại).
  - **Xử lý lỗi:** mọi `error`/tải hỏng → phát `update-error {message}` với lý do người-đọc-được (mất kết nối / hết dung lượng / file hỏng), KHÔNG throw ra ngoài. Marker version-không-khớp lúc boot → `update-failed`.
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

## 4. Bất biến / phản biện (gate phòng ngừa — CMD_BUILD phải thoả)
- `offline-safe`: server cập nhật **không với tới** → `checkForUpdates` nuốt lỗi, **app vẫn khởi động + đăng nhập + dùng bình thường**, không popup đỏ. **Gate bắt buộc** (đây là rủi ro cao nhất: đừng để cơ chế update làm chết app khi mất mạng/server tắt).
- `dev-guard`: `!app.isPackaged` → không gọi updater (tránh crash khi chạy dev/selftest).
- `no-auto-without-consent`: KHÔNG tự tải khi user chưa bấm (autoDownload=false) — đúng bước "push + xác nhận".
- `emit-trap`: verify LUÔN `npm run typecheck` (--noEmit); git sạch.
- `type-mirror-drift`: sửa `preload/index.d.ts` → web typecheck 0 + `audit:protected` PASS (chỉ Edit chèn).
- `ui-consistency`: banner + progress dùng token design system + toast chuẩn; không dựng chuông/panel mới.

## 5. Bằng chứng (AUDIT rerun sạch)
- `npm run typecheck`=0 · `npm run build`=0 · `npm test`≥205.
- **selftest MỚI =23 (update wiring)**: giả lập/nghe sự kiện — (a) `app.isPackaged=false` → updater KHÔNG khởi động (dev-guard); (b) so sánh version (mới>hiện=có update, ≤=không, semver đúng: 0.1.10>0.1.9); (c) khi `checkForUpdates` ném lỗi (server tắt) → handler nuốt, KHÔNG throw ra ngoài (offline-safe); (d) `update-downloaded` → ghi marker + gọi installNow đúng 1 lần; (e) **marker boot**: version khớp targetVersion → `update-success`+xoá marker; version KHÔNG khớp → `update-failed`; (f) **retry**: `update:check` gọi lại được sau lỗi (không kẹt trạng thái). `audit:protected` PASS · git sạch.
- **E2E tay (LEAD nghiệm thu R196):** build v hiện tại cài máy → đặt v cao hơn lên feed → mở app → thấy banner → bấm Cập nhật → tải → thoát → mở lại đúng version mới → footer hiện version mới. (Ghi checklist, Mr.Long xem.)
