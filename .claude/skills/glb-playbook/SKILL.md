---
name: glb-playbook
description: TOÀN BỘ kinh nghiệm dự án Quản Lý GLB — governance, kỷ luật test, phản biện/đối kháng, checklist bug-class, chống báo-cáo-láo & suy-luận, chống báo-OK-giả. Dùng cho MỌI việc GLB (viết code, review, audit, sửa bug, test, ship) và mọi task cần kỷ luật kỹ thuật cao. Đọc + áp NGAY khi bắt đầu bất kỳ task nào chạm code/QA của GLB, hoặc khi Mr.Long nói "check sâu", "đối kháng", "audit", "đào bug".
user-invocable: true
---

# /glb-playbook — Hiến pháp kỹ thuật & bài học dự án GLB

Áp cho MỌI task GLB. Đây là "cách làm để không lặp lại lỗi cũ". Chi tiết ship xem skill **`glb-ship`**.

## 0. Thẩm quyền & quy trình (R_SUPREME R1–R10)
- **Mr.Long = thẩm quyền DUY NHẤT.** Claude = người thực thi, KHÔNG tự quyết.
- Trình tự bắt buộc: **Read → Diff → Proposal → Approval(Mr.Long) → Backup(git sạch) → Patch → Regression → Production.**
- Không chắc → **STOP + hỏi**. Không tự mở rộng scope. Không tự ship.
- Phân vai đối kháng: **CMD_BUILD** (implement, KHÔNG tự claim PASS) ⟂ **CMD_AUDIT** (verify độc lập, KHÔNG sửa code cho "xanh").

## 1. CẤM báo cáo láo (nguyên tắc số 1)
- "Xong / PASS / sửa được / trống / xem được" **phải có bằng chứng chạy thật** — exit code, số đếm file/dòng, screenshot. **CẤM claim từ log/suy đoán.**
- Verdict = **exit-code / bằng chứng**, KHÔNG phải lời văn.
- Trước khi nói "còn nợ X" → **verify code HIỆN TẠI** (đừng tin index memory cũ — đã bắt hụt 1 lần).
- Tìm không thấy (`grep miss`) ≠ "chưa có" → thử nhiều format/tên trước khi kết luận.

## 2. CẤM suy luận
- Không tự đoán value/spec/policy/timing/naming. Không chắc → đánh dấu **TENTATIVE + hỏi Mr.Long**, block tới khi được duyệt.
- Sample/params Mr.Long đã OK → **giữ EXACT**, muốn đổi phải đề xuất trước, cấm đổi ngầm.

## 3. Kỷ luật TEST (chỗ hay lọt bug nhất)
- **REBUILD ngay trước selftest** (PF-09): thêm test sau `build` mà chạy `out/` cũ = false PASS → ship assertion sai. LEAD luôn rebuild từ HEAD trước mọi selftest.
- **Đổi hạ tầng/DB-engine/adapter/backup/IPC → rerun FULL suite** từ trạng thái sạch (không chỉ test liên quan).
- **Subagent "gate PASS" ≠ chạy selftest DB.** vitest xanh KHÔNG phủ nghiệp vụ DB. LEAD tự chạy full ST sạch trước ship. Test data phải HỢP LỆ theo validator app (vd username ≥8).
- **CẤM test trên DB sản xuất** `glb`. Chỉ dùng DB nháp (`createdb`→`dropdb`). Đọc chẩn đoán read-only thì được.
- **Test PASS ≠ check ĐÃ CHẠY (R198):** wrapper `try/catch` nuốt lỗi → check ném lỗi trông y hệt check sạch (vd PRAGMA SQLite chạy trên PG). Wrapper PHẢI biến lỗi thành finding + **đếm ĐỘNG** số check thực chạy. Đổi engine DB → test khẳng định TỪNG check chạy được.
- **Endpoint theo kỳ:** dùng 1 quy ước bound múi giờ (local half-open); seed test sát biên (rạng sáng mùng 1 / đêm cuối tháng).
- **Test orphan:** Test PASS ≠ rule đã codify → flush rule từ regression report vào BUGS_FIXED.

## 4. Phản biện / đối kháng (khi audit / "đào bug N vòng")
- "Đào sâu N vòng" → **mỗi vòng 1 phương pháp KHÁC** (property / snapshot / chi² / mutation / adversarial / concurrency), KHÔNG lặp lại cùng kiểu check.
- Verify **đối kháng**: cố REFUTE finding, không cố confirm. Đa góc nhìn (correctness / security / concurrency / repro).
- **Verify claim của audit ngoài bằng code/git THẬT** trước khi tin hoặc bác (audit từng nói sai "git 0.2.34" — thực 0.2.57).
- LEAD **tự tái hiện từng mã bug bằng selftest**, không claim từ static/lời agent. Không tin số agent báo — rerun sạch.
- Cặp agent QA độc lập review diff; guard chống clobber + pre-commit hook; CẤM `tsc -p` trần.

## 5. Bug = thất bại quy trình test
- Mỗi bug (LEAD/AUDIT/Mr.Long tìm) → **BẮT BUỘC**: (a) thêm regression chặn tái diễn, (b) lưu `BUGS_FIXED.md`, (c) **đề xuất thay đổi quy trình/bổ sung test** để loại đó không lọt lần nữa.
- **Bug-class extension:** ưu tiên MỞ RỘNG rule cùng nhóm thay vì 1 bug = 1 rule mới (ít rule, phủ rộng).

## 6. CHECKLIST bug-class (rà khi viết/review code GLB)
- **Tiền:** cột tiền = BigInt(int8); input chuỗi→BigInt trực tiếp ở biên, CẤM Number trung gian; chặn >MAX_SAFE; cộng dồn `giá×SL-thập-phân` phải `Math.round` từng dòng.
- **Ngày nghiệp vụ:** phải là ngày CÓ THẬT — chặn `new Date('2026-02-31')` cuộn ngầm; kiểm Y-M-D round-trip.
- **Bộ đếm bảo mật:** atomic increment + conditional transition, CẤM read-modify-write (race).
- **Quyền:** check bằng `hasPermission(user,'CODE')`, KHÔNG bằng tên role. Mã quyền IPC phải tồn tại (guard tĩnh) — fail-closed = mất tính năng âm thầm. Catalog quyền phải seed vào DB dùng chung ở CẢ vai client (idempotent + advisory-lock).
- **Xóa:** soft-delete; chặn xóa entity còn quan hệ sống ở CẢ lúc yêu-cầu LẪN lúc duyệt (re-guard in-tx); không xóa/khóa Admin cuối; không tự nâng quyền mình.
- **Chứng từ tiền:** hủy phải hoàn TẤT CẢ đối soát phát sinh từ nó; tiền + audit ATOMIC trong 1 `$transaction`.
- **Optimistic-lock:** mọi update qua form phải kiểm `expectedUpdatedAt` (STALE_WRITE); mọi DTO sửa-được phải lộ `updatedAt`.
- **Bất biến "duy nhất theo điều kiện":** phải có partial-unique DB backstop, không chỉ guard service.
- **DB tiến hóa:** cột/quyền ADDITIVE mà code đang đọc → self-heal `ADD COLUMN IF NOT EXISTS` mỗi boot (Prisma 7 không có migrate engine trong .exe).
- **Op phụ-thuộc-VAI-TRÒ-máy** (backup/pg_dump, đo ổ đĩa): gate `isServerRole()` + fail-closed rõ trên client.
- **Normalize master-data theo TÊN:** case-insensitive + trim + NFC trước khi so khớp; chỉ tạo entity khi có dữ liệu con.
- **Allowlist dữ liệu tài chính** (hình thức thanh toán…): giá trị lạ → VALIDATION, CẤM ép ngầm về mặc định.
- **Secret:** KHÔNG đi từ main sang renderer (chỉ lộ CỜ "đã-đặt", không lộ giá trị).
- **Engine sinh dữ liệu:** enforce trần nghiệp vụ THỰC TẾ ở service + cảnh báo tại form; vòng lặp tổ-hợp phải có **deadline cứng** (không chỉ giới hạn retry).

## 7. UI đổi PHẢI mở app + screenshot verify TRƯỚC khi ship
typecheck/build/selftest KHÔNG phủ tầng render (màu/logo/icon/3D/nút/khóa/form/overflow). Launch playwright-electron + screenshot + computed-style, khớp yêu cầu mới claim. Toast.alert 1 dialog lỗi to-rõ, UI đồng bộ font/cỡ/màu mọi trang. Task "áp cho MỌI trang" → liệt kê đủ đối tượng → checklist → done = 100% phủ.

## 8. Production Reality (R196)
Engineering PASS ≠ Production PASS. CẤM "done/100%" khi chưa **≥1 lần cài thật + Mr.Long nghiệm thu**. Dùng "Engineering PASS / chờ Production Validation". Đặc biệt UI/icon chỉ nghiệm thu được trên bản cài thật. **Tool built ≠ tool wired** — verify invocation, không chỉ registry.

## 9. Ship
Xem skill **`glb-ship`** (verify → rebuild+selftest → handtest → bump → commit/tag → build → deploy feed → verify công khai). Workflow: Build→Unit→Regression→Production Validation→Freeze→Tag→(rồi mới) tier kế. KHÔNG Build→Build→Build.

## 10. Registry (mỗi phiên)
Session start: đọc CLAUDE.md → IMS_SPEC → VERSION.md (so last_known_version) → BUGS_FIXED.md → memory feedback. Mọi fix lưu BUGS_FIXED + regression; mọi bump cập nhật VERSION.md.
