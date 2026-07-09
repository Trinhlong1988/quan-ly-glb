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

---
---

# G1 — Phase B — CMD_BUILD Report (Role/User CRUD · Audit UI · Backup/Restore)

> Vai: **CMD_BUILD**. KHÔNG tự claim PASS. Bằng chứng chạy thật ở dưới để **CMD_AUDIT** verify lại.
> Phạm vi Phase B (đúng brief): Role CRUD + permission assign · User CRUD (soft-delete) · Manager scope ·
> Audit UI · Backup/Restore + FutureSyncService · UI KiotViet các trang · confirm/password modals · toast ·
> audit before/after · Vitest + self-test tích hợp. **KHÔNG đóng `.exe`** (Phase C).
> Ngày: 2026-07-09 · Node v24.14.1 · Electron 33.4.11 (ABI 130).

## B0. Nguyên tắc bất di GIỮ NGUYÊN từ Phase A
- Renderer KHÔNG chạm DB — mọi mutation qua `ipcMain.handle` (26 kênh mới ở `ipc.ts`).
- Check quyền bằng `hasPermission(currentUser,'CODE')` từ session (`me()`), KHÔNG bằng role name.
  Đối chiếu bằng `guard.ts::requirePermission`. Thiếu quyền → `FORBIDDEN` + **audit `PERMISSION_DENIED`** (R_AUDIT_003).
- Audit MỌI mutation. Sửa ghi **before/after JSON** (`diffChanges`/`auditSnapshot`, redact password) — R_AUDIT_002.
- Không phá code Phase A (login/force-change/dashboard-shell giữ nguyên; Dashboard.tsx mở rộng thành content-router).

## B1. File mới / sửa
```
packages/shared/src/types.ts            (+ AuditAction 'PERMISSION_DENIED')
packages/business-rules/src/
  role.rules.ts      NEW  canDeleteRole/canLockRole/canUnlockRole/isProtectedAdminRole/isValidRoleCode
  backup.rules.ts    NEW  sha256Hex/verifyChecksum/buildBackupManifest/backupFileName/FutureSyncService(interface)
  audit.rules.ts     NEW  auditSnapshot(redact)/diffChanges(before/after)
  user.rules.ts      +    escalatedPermissions/grantsExceedActor (R_MANAGER_004)
  index.ts           +    re-export role/backup/audit rules
  *.test.ts          NEW  role.rules.test / backup.rules.test / audit.rules.test ; user.rules.test mở rộng
packages/database/prisma/
  schema.prisma      +    users.joinDate (§9 "Ngày vào làm")
  migrations/20260709120000_add_user_join_date/migration.sql  NEW
apps/desktop/src/main/
  guard.ts           NEW  requirePermission (audit-on-failure) + verifyActorPassword (server-side password)
  role-service.ts    NEW  list/permissions/create/update/lock/unlock/delete
  user-service.ts    NEW  list(filter)/create/update/lock/unlock/delete (soft) + manager scope
  audit-service.ts   NEW  listAudit (read-only; KHÔNG có delete endpoint — R_AUDIT_001)
  backup-service.ts  NEW  createBackup/listBackups/restoreBackup + futureSyncService (no-op)
  settings-service.ts NEW list/update (SETTING_UPDATED audit)
  zip.ts             NEW  store-method ZIP writer/reader (dependency-free — tránh npm install/ABI rebuild)
  selftest-phaseb.ts NEW  integration self-test (GLB_SELFTEST=2)
  ipc.ts             +    26 kênh role/user/audit/backup/setting
  index.ts           +    GLB_SELFTEST=2 hook
apps/desktop/src/preload/index.ts + index.d.ts   +  bridge + typings cho toàn bộ API mới
apps/desktop/src/renderer/src/
  components/ Modal.tsx · ConfirmDialog.tsx · StatusPill.tsx · Field.tsx   NEW
  pages/ RolesPage.tsx · StaffPage.tsx · AuditPage.tsx · BackupPage.tsx · SettingsPage.tsx  NEW
  pages/Dashboard.tsx   +  content-router (menu ẩn theo quyền, any-of)
```

## B2. Lệnh chạy THẬT + kết quả
| # | Lệnh | Kết quả | Exit |
|---|------|---------|------|
| 1 | `npm test` (Vitest) | **61 passed / 6 files** (Phase A 41 + Phase B 20 mới) | 0 |
| 2 | `tsc --noEmit -p tsconfig.node.json` (main) | **0 lỗi** | 0 |
| 3 | `tsc --noEmit -p tsconfig.web.json` (renderer) | **0 lỗi** | 0 |
| 4 | `npm run build -w @glb/desktop` | **build OK** (main+preload+renderer 312 KB); KHÔNG còn warning dynamic-import | 0 |
| 5 | `GLB_SELFTEST=2` integration (DB copy) | **24/24 PASS** | 0 |
| 6 | ZIP verify: PowerShell `Expand-Archive` | archive hợp lệ → `glb.db` (94208 B) + `backup_manifest.json` (275 B) | — |

### Vitest Phase B mới (20 test)
- `role.rules.test.ts` (10): R_ROLE_005 role-có-user · R_ROLE_006/007 ADMIN gốc bất khả xâm · lock/unlock state · role-code regex.
- `backup.rules.test.ts` (4): sha256 vector "hello" · verifyChecksum phát hiện tamper · manifest shape · filename §17.
- `audit.rules.test.ts` (4): redact password · diff chỉ field đổi.
- `user.rules.test.ts` (+2): R_MANAGER_004 escalation (admin qua, manager grant quyền vượt → chặn).

### Self-test tích hợp `GLB_SELFTEST=2` (chạy service THẬT trên bản copy DB)
```
admin login ok · admin creates MANAGER user · admin creates SALES user
duplicate username blocked · invalid username blocked
cannot delete last admin (R004) · cannot delete role-with-users (R_ROLE_005)
cannot delete ADMIN system role (R_ROLE_006)
admin creates custom role · role delete wrong password blocked (R_ROLE_009) · role delete correct password ok
admin creates backup · backup has checksum + file exists
restore wrong password blocked (R_BACKUP_002) · restore correct password ok
restore auto-created pre-restore backup (R_BACKUP_003)   {before:1, after:2}
manager login ok · manager cannot create ADMIN (R_MANAGER_002) · manager creates limited user (R_MANAGER_001)
manager cannot create role → FORBIDDEN (§13)
sales login ok · sales cannot list users → FORBIDDEN
permission denials were audited (R_AUDIT_003)   {deniedBefore:0, deniedAfter:3}
SELFTEST2 SUMMARY | failures=0   (exit 0)
```

## B3. Trạng thái hạng mục Phase B
| Hạng mục | Rule | Trạng thái | Bằng chứng |
|---|---|---|---|
| Role CRUD + assign permission | R_ROLE_001..004/008/010 | enforced | selftest create/update/lock/unlock/delete + audit; RolesPage UI |
| Chặn xóa role có user | R_ROLE_005 | enforced | vitest + selftest ROLE_HAS_USERS |
| Chặn xóa/khóa ADMIN gốc | R_ROLE_006/007 | enforced | vitest + selftest ROLE_IS_SYSTEM_ADMIN |
| Xóa role nhập lại mật khẩu (verify server) | R_ROLE_009 | enforced | selftest wrong-pw blocked; `verifyActorPassword` |
| User CRUD + soft-delete | §9/§11 R_USER_STATUS_006 | enforced | selftest create/dup/invalid; deleteUser set status=DELETED+deletedAt |
| Username `^[A-Za-z0-9]{8,}$` + email unique | §10 | enforced | vitest 17 + selftest DUPLICATE/VALIDATION |
| Chặn xóa/khóa Admin cuối | R004/R005 | enforced | vitest + selftest LAST_ADMIN |
| Không tự nâng quyền chính mình | R006 | enforced (code) | `isSelfPrivilegeEscalation` trong updateUser; vitest |
| Manager scope (không tạo ADMIN/MANAGER, không cấp quyền vượt) | R_MANAGER_001..006 | enforced | selftest MANAGER_SCOPE + vitest escalation |
| Permission check bằng CODE (không role name) | §13 | enforced | `guard.requirePermission`; selftest FORBIDDEN |
| Audit mọi mutation + before/after | §16 R_AUDIT_002 | enforced | writeAudit ở mọi service; AuditPage hiển thị |
| Audit thất bại-thiếu-quyền | R_AUDIT_003 | enforced | selftest deniedAfter=3; PERMISSION_DENIED |
| Audit UI không xóa được | R_AUDIT_001/004 | enforced | audit-service chỉ có listAudit (không delete) |
| Backup zip + manifest + checksum + backup_logs | R_BACKUP_001/004 | enforced | selftest + Expand-Archive verify |
| Restore nhập mật khẩu + self-backup trước | R_BACKUP_002/003 | enforced | selftest restore path |
| FutureSyncService interface | R_BACKUP_006 | enforced (interface, no-op) | `futureSyncService` throws NOT_IMPLEMENTED |
| Popup xác nhận có nút Hủy; xóa nhập mật khẩu | §14 | enforced (UI) | ConfirmDialog (Hủy luôn có) + requirePassword |
| Toast sau mọi thao tác | §15 | enforced (UI) | useToast ở mọi page |
| Menu ẩn theo quyền | §6 | enforced (UI) | Dashboard visible=hasAnyPermission |
| UI KiotViet các trang §19 | §19 | enforced (UI, build OK) | 5 page + palette Phase A |
| Restore swap-on-restart (áp DB đã stage) | — | **roadmap (Phase C)** | restore ghi `glb.db.restored`; chưa wire swap lúc khởi động |
| Đóng gói `.exe` | §21#2 | roadmap (Phase C) | ngoài scope |

## B4. Rủi ro / giới hạn (khai báo trung thực)
1. **Restore = staged, chưa swap.** `restoreBackup` verify checksum + tự backup hiện trạng + ghi `glb.db.restored`
   cạnh DB sống (KHÔNG ghi đè DB đang mở để tránh hỏng handle SQLite). Việc **swap khi khởi động lại** chưa wire →
   Phase C. UI báo đúng thông điệp "sẽ áp dụng khi khởi động lại". Không overclaim là restore hoàn tất.
2. **`join_date` áp bằng ALTER TABLE thủ công qua Electron-runtime** (better-sqlite3 ABI 130), + file migration SQL
   cho DB mới. Prisma client đã regenerate (nhưng `generated/` bị `.gitignore` → CMD_AUDIT phải chạy
   `cd packages/database && npx prisma generate` để có type joinDate trước typecheck).
3. **Prod first-run vẫn thiếu schema** (kế thừa finding Phase A #2) — `.exe` chưa chạy được trên DB rỗng. Phase C.
4. **UI drive tự động chưa chụp screenshot** các trang mới (harness SendKeys lệch ký tự như Phase A). Bằng chứng
   nghiệp vụ = self-test service-level + build OK + typecheck. LEAD nên `npm run dev` để nghiệm thu thị giác (R196).
5. **Backup dir dev = `process.cwd()/backups`** (prod = userData/backups). Đã `.gitignore`.

## B5. Evidence để CMD_AUDIT chạy lại
```bash
cd packages/database && npx prisma generate && cd ../..     # (generated/ bị gitignore)
npm test                                                    # kỳ vọng 61 passed
cd apps/desktop && npx tsc --noEmit -p tsconfig.node.json && npx tsc --noEmit -p tsconfig.web.json && cd ../..
npm run build -w @glb/desktop                               # exit 0, không warning
cp packages/database/dev.db "$TEMP/glb_phaseb.db"
GLB_SELFTEST=2 GLB_DB_URL="file:$TEMP/glb_phaseb.db" ./node_modules/.bin/electron apps/desktop
#   kỳ vọng 24 dòng SELFTEST2 PASS + SUMMARY failures=0 (exit 0)
npm run dev -w @glb/desktop                                 # nghiệm thu thị giác các trang KiotViet
```

## B6. Verdict Phase B
Role/User CRUD · Manager scope · Audit (ghi + UI đọc) · Backup/Restore · permission-by-code · confirm/password/toast
**CHẠY THẬT + đúng luật** — chứng minh bằng 61 vitest + 24 self-test tích hợp service-level (exit 0) + build/typecheck sạch.
Còn **roadmap Phase C**: restore swap-on-restart · prod DB provisioning · `.exe`. Theo R196 đây là **L1 Engineering
Validation PASS** — chờ LEAD (Mr.Long) `npm run dev` nghiệm thu thật mới lên L2.

`READY_FOR_AUDIT: YES` (Phase B. §21 toàn phần chưa PASS: #2 `.exe` = Phase C.)
