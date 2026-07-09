# G1 AUDIT REPORT — Phase A slice (Login → Force Change → Dashboard)

**Auditor:** CMD_AUDIT (Claude, độc lập với CMD_BUILD).
**Ngày:** 2026-07-09. **Commit gốc audit:** sau `d064ba5` (apps/desktop chưa commit lúc audit).
**Verdict:** ✅ **ENGINEERING PASS cho Phase A slice** — KHÔNG phải Production PASS (R196), KHÔNG phải full G1 §21.

## B1 — Chạy lại bằng máy (CMD_AUDIT tự chạy, không tin report builder)
| Lệnh | Kết quả | Exit |
|------|---------|------|
| `npm test` (root, Vitest) | **41/41 PASS** (validators 17 + user.rules 11 + auth.rules 13) | 0 |
| `npm run typecheck -w @glb/desktop` (tsc node+web) | **0 lỗi** | 0 |
| `npm run build -w @glb/desktop` (electron-vite) | build OK, font Be Vietnam Pro bundle offline (woff2) | 0 |
| Headless self-test (`GLB_SELFTEST=1`, DB copy riêng) | **5/5** ↓ | 0 |

Self-test (chạy trên bản copy `selftest.db`, dev.db giữ nguyên):
- `wrong_password` → `ok:false, error:INVALID_CREDENTIALS` (KHÔNG lộ status — bảo mật ✓)
- `admin_login` → `ok:true, mustChange:true, roles:[ADMIN], perms:20` (R002 bcrypt + R003 force-change ✓)
- `change_password` → ok · `restore_password` → ok · `me` → `adminroot` (session ✓)

## B4 — Đọc code rule-critical
- `auth-service.login`: verify password TRƯỚC status → sai mật khẩu luôn `INVALID_CREDENTIALS`, không lộ tài khoản khóa/pending. Audit `LOGIN_FAILED`/`LOGIN_SUCCESS` có actor + reason. ✓
- `buildAuthUser`: chỉ role `ACTIVE` mới cấp permission (role LOCKED = 0 quyền). ✓
- `changePassword`: verify current + `validatePassword` + chặn trùng mật khẩu cũ + clear `force_change_password` + audit `PASSWORD_CHANGED`. ✓ (nghiêm hơn spec)
- `ipc.ts`: renderer KHÔNG chạm DB — mọi thao tác sau `ipcMain.handle`. contextIsolation on, nodeIntegration off. ✓
- `remember.ts`: credential mã hóa qua `safeStorage`, plaintext không rời main. ✓
- `Dashboard.tsx`: menu lọc theo `hasPermission(user, perm)` → **R010 ẩn theo quyền** (không disable). ✓ check bằng permission, KHÔNG bằng role (§13). ✓
- `App.tsx`: routing login → (mustChange||forceChangePassword) → force-change → dashboard. ✓

## B7 — Đối chiếu §21 (chỉ các mục thuộc Phase A)
| §21 | Điều kiện | Phase A |
|----|-----------|---------|
| #1 | Chạy được local | ✅ build+run thật |
| #3 | Login `adminroot` | ✅ self-test |
| #4 | Buộc đổi mật khẩu lần đầu | ✅ mustChange=true + routing |
| #8 | Username validate đúng rule | ✅ 17 test |
| #15 | Audit log | ✅ LOGIN_*/PASSWORD_CHANGED ghi thật |
Các mục #2 (.exe), #5–7/#9–14/#16 (role/user/backup) = **Phase B/C, chưa claim**.

## Findings (không chặn Phase A, phải xử ở Phase B/C)
1. **[UI-evidence]** `apps/desktop/build/after_login_screenshot.png` **sai nhãn** — thực chất là màn login (đang hiện mật khẩu + lỗi inline), KHÔNG phải Dashboard. Dashboard verify qua CODE + routing, chưa có screenshot thật. → Phase B: chụp lại Dashboard thật.
2. **[PROD-DB]** DB đóng gói `userData/glb.db` chưa có migration schema; `.exe` chạy lần đầu trên DB rỗng sẽ lỗi "no such table" (seedIfEmpty cần bảng trước). Dev ẩn lỗi này vì trỏ `packages/database/dev.db`. → **Chặn .exe, phải fix Phase C** (ship migrations / `db push` on first run). Builder đã khai báo trung thực.
3. **[ABI]** better-sqlite3 rebuild cho Electron (ABI 130) → hỏng dưới Node 24 → `npm run db:seed`/Prisma CLI dưới Node ABI-fail. → Phase C: postinstall `electron-rebuild` + tách ABI dev-node/electron.
4. **[SELFTEST-HOOK]** `GLB_SELFTEST` còn trong `src/main/index.ts` (env-gated, vô hại, hữu ích cho audit). Giữ tới khi có CI.

## Kết luận
Slice Phase A **CHẠY THẬT + đúng luật auth/permission**. Đủ điều kiện chuyển Phase B (role/user CRUD + audit UI + backup). **Chưa** đóng `.exe` (finding #2/#3). Theo R196: đây là L1 Engineering PASS — chờ **LEAD (Mr.Long) tự chạy `npm run dev` + chấp nhận** mới lên L2 và mới push repo.
