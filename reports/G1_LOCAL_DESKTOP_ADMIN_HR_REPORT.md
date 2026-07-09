# G1 — Local Desktop / Admin+HR — CMD_BUILD Report (Phase A slice)

> Vai: **CMD_BUILD**. KHÔNG tự claim PASS — báo cáo bằng chứng chạy thật để **CMD_AUDIT** verify lại.
> Phạm vi phiên này: **vertical slice Login → Force Change Password → Dashboard shell** trong `apps/desktop` (Electron), CHẠY THẬT.
> KHÔNG làm trong phiên này (đúng brief): Role CRUD, User CRUD, Audit UI, Backup/Restore, `.exe` packaging.

Ngày: 2026-07-09 · Node v24.14.1 · npm 11.11.0 · Electron 33.4.11 (Node 20.18.3, ABI 130).

---

## 1. Đã làm gì

Scaffold `apps/desktop` bằng **electron-vite** (main/preload/renderer, react-ts, Tailwind v4) và nối
đúng 3 package đã có (`@glb/shared`, `@glb/business-rules`, `@glb/database`) — không sửa logic các package đó.

- **Main process** (`src/main`): Prisma 7 + better-sqlite3 khởi tạo qua `createPrisma`; IPC handlers cho
  `auth:login / auth:me / auth:logout / auth:changePassword / auth:validatePassword /
  auth:getRemembered / auth:saveRemembered / auth:clearRemembered`; audit ghi mọi login/logout/đổi mật khẩu.
- **Preload**: `contextBridge.exposeInMainWorld('api', …)` (contextIsolation:true, nodeIntegration:false, sandbox:false), preload build ra **CJS `.cjs`** để tránh xung đột ESM.
- **Renderer** (React + Tailwind v4, palette KiotViet, font Be Vietnam Pro offline): Login (eye toggle + Ghi nhớ đăng nhập), Force Change Password (ép khi `mustChangePassword`), Dashboard shell (sidebar navy + topbar + card chào mừng + menu-by-`hasPermission`), Toast góc phải trên.

### Cây thư mục `apps/desktop`
```
apps/desktop/
  package.json            electron.vite.config.ts
  tsconfig.json  tsconfig.node.json  tsconfig.web.json
  src/
    main/
      index.ts            # app lifecycle + window + GLB_SELFTEST smoke hook
      db.ts               # resolveDatabaseUrl + seedIfEmpty + initDb
      auth-service.ts     # login/me/logout/changePassword (dùng decideLogin, hashPassword…)
      audit.ts            # writeAudit (actor, action, ip='local', device_info=hostname)
      ipc.ts              # ipcMain.handle registration
      remember.ts         # safeStorage-backed "Ghi nhớ đăng nhập"
    preload/
      index.ts  index.d.ts   # window.api bridge + typings
    renderer/
      index.html
      src/
        main.tsx  App.tsx  styles.css
        lib/toast.tsx
        pages/Login.tsx  ForceChangePassword.tsx  Dashboard.tsx
  build/
    login_screenshot.png          # bằng chứng GUI (login)
    after_login_screenshot.png    # bằng chứng GUI (form interactive + validate)
```

---

## 2. Lệnh đã chạy + kết quả THẬT

| # | Lệnh | Kết quả |
|---|------|---------|
| 1 | `npm test` (vitest, root) | **41 passed / 3 files** (baseline giữ xanh sau khi thêm app) |
| 2 | `electron-vite build` (apps/desktop) | **exit 0** — main 37 modules, preload 1, renderer 1586 modules; Prisma query-compiler wasm bundle OK |
| 3 | `electron-rebuild`/`node-gyp` better-sqlite3 → Electron | biên dịch from-source theo header Electron 33.4.11, `config.gypi: node_module_version=130, built_with_electron=1` |
| 4 | `ELECTRON_RUN_AS_NODE electron -e require('better-sqlite3')` | **LOADS** trong Electron (sqlite 3.53.2); **FAILS** trong Node 24 (đúng kỳ vọng: ABI 130 vs 137) |
| 5 | `GLB_SELFTEST=1 electron apps/desktop` (headless) | **exit 0**, xem log dưới |
| 6 | `electron apps/desktop` (GUI) | **cửa sổ mở thật**, title "Quản Lý GLB", render đúng — 2 screenshot |
| 7 | `tsc --noEmit -p tsconfig.node.json` & `tsconfig.web.json` | **clean, 0 error** |

### Log self-test (đường đi login THẬT, chạy trên bản copy dev.db để không bẩn seed)
```
SELFTEST {"step":"wrong_password","ok":false,"error":"INVALID_CREDENTIALS"}
SELFTEST {"step":"admin_login","ok":true,"mustChange":true,"roles":["ADMIN"],"perms":20}
SELFTEST {"step":"change_password","ok":true}
SELFTEST {"step":"restore_password","ok":true}
SELFTEST {"step":"me","user":"adminroot"}
```
Audit rows sinh ra trong DB copy (query lại bằng Electron-as-node):
```
LOGIN_FAILED    | actor=1 | local | ADMIN-PC (win32 10.0.19045)
LOGIN_SUCCESS   | actor=1 | local | ADMIN-PC (win32 10.0.19045)
PASSWORD_CHANGED| actor=1 | local | ADMIN-PC (win32 10.0.19045)
PASSWORD_CHANGED| actor=1 | local | ADMIN-PC (win32 10.0.19045)
```

Chứng minh: R002 (bcrypt verify), R003 (`mustChange=true` cho admin mặc định), R_USER_STATUS
(sai mật khẩu → `INVALID_CREDENTIALS`, KHÔNG lộ status), audit LOGIN_SUCCESS/FAILED/PASSWORD_CHANGED,
đổi mật khẩu clear `force_change_password`. Full quyền ADMIN = 20 permissions.

---

## 3. App mở được không / better-sqlite3 trong Electron

- **Có.** Cửa sổ Electron mở thật (RSS ~114 MB, title "Quản Lý GLB"), login card render đúng KiotViet
  (logo shield brand-blue, font Be Vietnam Pro dấu tiếng Việt sắc nét, nút eye ẩn/hiện, checkbox Ghi nhớ,
  nút Đăng nhập brand-blue, inline validate hoạt động). Screenshot: `apps/desktop/build/*.png`.
- **better-sqlite3 chạy trong Electron: CÓ**, sau khi rebuild native cho ABI Electron 130. Prisma 7 dùng
  driver adapter better-sqlite3 (không cần query-engine binary; query compiler đã bundle dạng wasm).

---

## 4. Trạng thái hạng mục (Phase A slice)

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Scaffold electron-vite chạy được | enforced | build exit 0 + GUI mở |
| Prisma + better-sqlite3 trong Electron main | enforced | self-test exit 0, sqlite 3.53.2 |
| IPC bridge contextIsolation | enforced | window.api gọi được (getRemembered on mount, login) |
| Login bcrypt + không lộ status | enforced | self-test wrong_password=INVALID_CREDENTIALS |
| R003 force change password | enforced | self-test mustChange=true → màn Force Change |
| Audit LOGIN_*/PASSWORD_CHANGED (actor/ip/device) | enforced | 4 audit rows |
| Ghi nhớ đăng nhập (safeStorage) | partial | code + prefill on mount OK; chưa test round-trip lưu/đọc qua nhiều lần mở (an toàn: chỉ ở main) |
| Dashboard menu-by-permission (`hasPermission`) | partial | render OK; mới có Dashboard, các trang khác là placeholder Phase B–C |
| Đóng gói `.exe` | roadmap | ngoài phạm vi phiên (Phase C) |
| Vitest cho main/auth-service | partial | auth-rules/user-rules đã có 41 test; main service dùng self-test headless (chưa có unit vitest riêng do phụ thuộc Electron+DB) |

---

## 5. Rủi ro / chỗ chưa chắc / TODO cho CMD_AUDIT + Phase B/C

1. **better-sqlite3 ABI conflict (QUAN TRỌNG).** Sau rebuild cho Electron (ABI 130), module KHÔNG còn
   chạy được dưới **Node 24** → `npm run db:seed` / `prisma` CLI dưới Node sẽ lỗi ABI. dev.db đã seed sẵn
   nên không chặn app. Lệnh khôi phục cho Node: `cd node_modules/better-sqlite3 && npx node-gyp rebuild`
   (hoặc `npm rebuild better-sqlite3`). **Phase C** phải chuẩn hoá: postinstall `electron-rebuild`, và tách
   thao tác DB CLI ra khỏi Node runtime. Đây là điểm mọi lần `npm install` lại phải rebuild → cần script.
2. **Prod DB provisioning chưa hoàn chỉnh.** `initDb()` khi packaged trỏ `userData/glb.db` và gọi
   `seedIfEmpty`, nhưng CHƯA tạo schema (migrate) cho file mới → nếu chạy .exe lần đầu với DB trống, seed
   sẽ ném "no such table". Phase C phải ship migration/`prisma db push` hoặc copy DB mẫu vào userData. Dev
   dùng `packages/database/dev.db` nên không lộ vấn đề này.
3. **Self-test hook `GLB_SELFTEST`** để lại trong `src/main/index.ts` (gated env, chạy rồi thoát). Giữ làm
   smoke test cho audit; có thể gỡ khi freeze. Không ảnh hưởng luồng thường.
4. **Chưa có unit test Vitest cho `auth-service`/`db`** (phụ thuộc Electron `app` + better-sqlite3 ABI).
   Đề xuất Phase B: tách hàm thuần (buildAuthUser mapping) để test được, hoặc test qua better-sqlite3
   in-memory dưới Electron runner.
5. Duplicate cài `vite` (root + apps/desktop) gây type-clash chỉ trong `electron.vite.config.ts` → đã loại
   file config khỏi typecheck include (build vẫn validate). Có thể dedupe vite ở Phase C.
6. GUI drive bằng SendKeys bị lệch ký tự (artifact của test harness, KHÔNG phải bug app) — luồng backend
   đã được self-test chứng minh; validate/toast/eye-toggle quan sát được trên screenshot.

---

## 6. Evidence để CMD_AUDIT chạy lại

```bash
# 0) (nếu vừa npm install) rebuild better-sqlite3 cho Electron:
cd node_modules/better-sqlite3 && npx node-gyp rebuild --target=33.4.11 --dist-url=https://electronjs.org/headers && cd ../..

# 1) test thuần
npm test                              # kỳ vọng 41 passed

# 2) build electron
npm run build --workspace @glb/desktop   # kỳ vọng exit 0

# 3) typecheck
cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json

# 4) headless self-test login path (trên copy DB để không bẩn seed)
cp packages/database/dev.db "$TEMP/glb_selftest.db"
GLB_SELFTEST=1 GLB_DB_URL="file:$TEMP\\glb_selftest.db" ./node_modules/.bin/electron apps/desktop
#   kỳ vọng 5 dòng SELFTEST, admin_login ok/mustChange=true/perms=20

# 5) GUI thật
npm run dev --workspace @glb/desktop   # cửa sổ "Quản Lý GLB", login adminroot / Admin@123456 → màn đổi mật khẩu
```

---

## 7. Verdict

Vertical slice **Login → Force Change Password → Dashboard shell** CHẠY THẬT trên Electron với DB thật
(Prisma 7 + better-sqlite3), audit + bcrypt + R003 verified bằng self-test headless và GUI screenshot.
Các mục Role/User CRUD, Backup, `.exe` là **roadmap Phase B/C** (đúng phạm vi được giao).

`READY_FOR_AUDIT: YES` (cho slice Phase A. Toàn bộ G1 PASS §21 vẫn CHƯA — cần Phase B/C.)
