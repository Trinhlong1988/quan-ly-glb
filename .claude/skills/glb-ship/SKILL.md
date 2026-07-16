---
name: glb-ship
description: Quy trình ship AN TOÀN dự án Quản Lý GLB (Electron + Prisma 7 + PostgreSQL, repo D:\TT HKD AI\tools\quan-ly-glb). Dùng khi đã sửa code GLB và cần verify + build + deploy, hoặc khi Mr.Long nói "ship", "build bản mới", "dọn nợ rồi ship". Bao gồm đủ gate typecheck/vitest/selftest/handtest + bump version + commit/tag + build .exe + deploy feed Cloudflare + cập nhật BUGS_FIXED/VERSION. Tôn trọng governance R_SUPREME + R196.
user-invocable: true
---

# /glb-ship — Ship an toàn dự án Quản Lý GLB

Repo: `D:\TT HKD AI\tools\quan-ly-glb`. PostgreSQL local: `localhost:5432` user `postgres` / `Glb@Pg2026`, `GLB_PG_BIN=D:/PostgreSQL16/pgsql/bin`. Máy này LÀ máy chủ (feed + DB).

## Luật cứng (không được phá)
- **CẤM báo cáo láo:** mọi "xong/pass/sửa được" phải có bằng chứng chạy thật. CẤM claim từ log/suy luận.
- **CẤM test trên DB sản xuất `glb`:** chỉ dùng DB nháp (`createdb` → `dropdb`). Đọc chẩn đoán read-only thì được.
- **CẤM suy luận** value/spec: không chắc → hỏi Mr.Long, đánh dấu TENTATIVE.
- **R_SUPREME:** Read → Diff → Proposal → **Approval của Mr.Long** → Backup(git sạch) → Patch → Regression → Production. Không tự ship khi chưa được duyệt.
- **R196:** Engineering PASS ≠ Production PASS. CẤM nói "done/100%" khi chưa ≥1 lần cài thật + Mr.Long nghiệm thu. Dùng "Engineering PASS / chờ Production Validation".
- **R198:** test PASS phải chứng minh check ĐÃ CHẠY (không chỉ "không finding"); đổi engine DB → test từng check chạy được.
- **Bug = lỗi quy trình test:** mỗi fix PHẢI thêm regression + lưu `BUGS_FIXED.md`.

## Bước 1 — Verify (bắt buộc, theo thứ tự)
```bash
cd "D:/TT HKD AI/tools/quan-ly-glb"
npm run typecheck            # tsc node + web = 0 lỗi (CẤM `tsc -p` trần)
npm test                     # vitest run — tất cả xanh
npm run audit:protected      # guard preload/index.d.ts (2233 dòng, 5 anchor)
npm run audit:deferred       # guard hoãn ngầm
```

## Bước 2 — REBUILD rồi selftest DB (PF-09: rebuild TRƯỚC selftest)
```bash
cd "D:/TT HKD AI/tools/quan-ly-glb/apps/desktop" && npx electron-vite build   # PHẢI rebuild trước
cd "D:/TT HKD AI/tools/quan-ly-glb" && export GLB_PG_BIN='D:/PostgreSQL16/pgsql/bin'
node tools/selftest/run-selftest-pg.mjs 2 <các số liên quan>   # runner tự createdb→migrate→chạy→dropdb
```
Selftest số hay dùng: ST2 core, ST16 storage, ST17 healthscan, ST36 backup, ST39 poslifecycle, ST40 warehouse, ST41 devicesale, ST42 handover, ST43 export-request, ST44 bill-explain. Chạy **các ST liên quan tới phần vừa sửa** + ST2. Yêu cầu `failures=0` trên build MỚI.

## Bước 3 — Handtest UI (nếu sửa giao diện — bắt buộc)
Sửa render (màu/nút/icon/khóa/form) thì typecheck/vitest/selftest KHÔNG phủ → PHẢI mở app playwright-electron + screenshot + đọc computed-style, khớp yêu cầu mới claim. (Xem lại cách launch: `_electron.launch({args:['apps/desktop'], cwd:repoRoot, env:{GLB_ROLE:'server', GLB_DB_URL:<db nháp>, GLB_DISABLE_UPDATE:'1'}})`; admin `adminroot`/`Admin@123456` lần đầu bắt đổi mật khẩu.)

## Bước 4 — Registry + bump version
- `BUGS_FIXED.md`: thêm `### B<NN> — … [FIXED]` (Phát hiện bởi · Nguyên nhân · Fix · **Regression** · Bug class) + cập nhật dòng Counter + "Last ship".
- `VERSION.md`: cập nhật `current_version` + `status` (prepend bản mới, giữ lịch sử) + `last_update_ts` + thêm mục "## Nhật ký phiên bản".
- Bump **cả 2**: `package.json` (root) + `apps/desktop/package.json` cùng số.

## Bước 5 — Commit + tag + push
```bash
cd "D:/TT HKD AI/tools/quan-ly-glb"
git add apps/desktop/src package.json apps/desktop/package.json apps/desktop/electron-builder.yml VERSION.md BUGS_FIXED.md
git commit -m "0.2.<N> — <tóm tắt>

<gạch đầu dòng từng fix>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
git tag v0.2.<N>
git push origin main --tags
```
(Pre-commit hook chạy 2 guard — phải PASS.)

## Bước 6 — Build .exe
```bash
cd "D:/TT HKD AI/tools/quan-ly-glb/apps/desktop" && npx electron-builder --win
# ra dist/glb-0.2.<N>-setup.exe + .blockmap + latest.yml
```

## Bước 7 — Deploy feed (dùng bash `cp` — sandbox chặn PowerShell Copy -Force ở D:\glb-updates)
```bash
DIST="/d/TT HKD AI/tools/quan-ly-glb/apps/desktop/dist"; FEED="/d/glb-updates"; DESK="/c/Users/Administrator/Desktop"
cp "$DIST/glb-0.2.<N>-setup.exe" "$DIST/glb-0.2.<N>-setup.exe.blockmap" "$DIST/latest.yml" "$FEED/"
cp "$DIST/glb-0.2.<N>-setup.exe" "$DESK/"
# gói onboarding: cập nhật version trong HUONG_DAN_CAI_DAT.txt rồi 7z -tzip (setup + GLB_MayNgoai_Setup.ps1 + txt); build ở $CLAUDE_JOB_DIR/tmp rồi cp ra
```

## Bước 8 — Verify feed công khai (bằng chứng, không suy luận)
```bash
curl -s https://glb-update.mecaglb.vn/updates/latest.yml | grep version   # phải ra version mới → 8 máy tự update
```

## Bước 9 — Báo cáo Mr.Long
Tóm tắt bảng: fix nào, verify gì (số liệu thật), còn nợ gì. **Nêu rõ mục nào chờ Production Validation** (cài thật + Mr.Long nghiệm thu) — đặc biệt thay đổi UI/icon chỉ nhìn được trên bản cài. Không claim "done" cho phần chưa PV.
