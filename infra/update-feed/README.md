# GLB Update Feed — hạ tầng cập nhật LAN (G11 §3)

Feed HTTP tĩnh phục vụ `electron-updater` cho mọi client Quản Lý GLB trong LAN.
Dựng trên máy chủ **192.168.1.6** (cùng máy Postgres), cổng **8686**.

- Provider (baked vào app qua `apps/desktop/electron-builder.yml`): `generic` → `http://192.168.1.6:8686/updates/`, channel `latest`.
- Thư mục phục vụ: **`D:\glb-updates\`** (map tại URL prefix `/updates/`). Chứa `latest.yml` + `glb-<ver>-setup.exe` + `glb-<ver>-setup.exe.blockmap`.
- Server: `server.mjs` (Node thuần, không thêm dependency). Hỗ trợ **Range/206** (electron-updater differential), chống path-traversal, chỉ GET/HEAD.

## Chạy / bền qua reboot
Scheduled Task **`GLB_UpdateFeed`** (ONSTART, chạy dưới `SYSTEM`, RL HIGHEST) gọi `run-feed.cmd` → server nghe `0.0.0.0:8686`.
Log: `D:\glb-updates\_feed.log` (ghi đè mỗi lần khởi động).

```powershell
schtasks /Run    /TN "GLB_UpdateFeed"     # khởi động ngay
schtasks /End    /TN "GLB_UpdateFeed"     # dừng
schtasks /Query  /TN "GLB_UpdateFeed" /V  # trạng thái
```
Chạy tay để debug: `node infra/update-feed/server.mjs` (đọc env `GLB_FEED_DIR`/`GLB_FEED_PORT`/`GLB_FEED_HOST`).

Kiểm nhanh: `curl http://192.168.1.6:8686/` (health, liệt kê file) · `curl http://192.168.1.6:8686/updates/latest.yml`.

## Firewall
Rule inbound **`GLB Update Feed 8686`**: TCP 8686, `remoteip=192.168.1.0/24` (CHỈ LAN). Thêm/kiểm:
```powershell
netsh advfirewall firewall show rule name="GLB Update Feed 8686"
```

## Quy trình phát hành bản mới (LEAD)
1. **Bump version ở `apps/desktop/package.json`** (KHÔNG phải root — `app.getVersion()` + electron-builder đọc file này; M2).
2. `cd apps/desktop && npx electron-vite build && npx electron-builder --win --publish never`
   → sinh `dist/latest.yml` + `dist/glb-<ver>-setup.exe` + `.blockmap` (tên ASCII, M1).
   - Nếu lỗi `EBUSY unlink win-unpacked\icudtl.dat`: có instance app đóng gói đang chạy — `taskkill /F /IM "Quản Lý GLB.exe"` (hoặc kill PID chạy từ `dist\win-unpacked`) rồi build lại.
3. Copy 3 file vào `D:\glb-updates\` (ghi đè). Client tự thấy ở lần kiểm tra kế (lúc mở app + mỗi 60 phút).

## Rollback
Giữ exe bản-tốt-gần-nhất. Nếu bản mới lỗi: **bump version CAO HƠN** trỏ về build cũ rồi phát hành lại (electron-updater KHÔNG tự hạ cấp — sửa `latest.yml` về version thấp hơn sẽ không kích hoạt update).

## An ninh (M7 — rủi ro CHẤP NHẬN CÓ CHỦ ĐÍCH, Mr.Long biết)
Feed HTTP nội bộ **không auth** + exe **chưa ký số** (D02). Kẻ trong LAN ghi được `D:\glb-updates\` có thể đẩy `latest.yml`+exe giả → chạy mã tùy ý trên client ở update kế. Giảm thiểu: chỉ LEAD ghi `D:\glb-updates\` (ACL), firewall chỉ LAN 192.168.1.0/24, server chỉ đọc. Nâng cấp thật khi phát hành ngoài LAN = HTTPS + ký số.
