# Quản Lý GLB — Internal Management System (IMS)

> Phần mềm quản lý nội bộ GLOBEWAY (doanh thu / kho / thu chi). Desktop-first, chạy local, đóng gói `.exe`, backup local → sau này sync VPS/PostgreSQL.
> Giai đoạn hiện tại: **G1 = Local Desktop + Admin + Role + User + Audit + Backup**.

> ⚙️ **LUÔN ÁP MỖI PHIÊN — nạp skill `glb-playbook` (toàn bộ bài học/kỷ luật) + `glb-ship` (quy trình ship).**
> Mọi task chạm code/QA GLB, hoặc khi Mr.Long nói "check sâu / đối kháng / audit / đào bug / ship" → **gọi skill tương ứng trước khi làm**. 5 luật cốt lõi luôn nhớ:
> 1. **CẤM báo cáo láo** — "xong/PASS" phải có bằng chứng chạy thật (exit-code/số đếm/screenshot), không claim từ log.
> 2. **CẤM suy luận** value/spec — không chắc → TENTATIVE + hỏi Mr.Long.
> 3. **Rebuild TRƯỚC selftest**; đổi hạ tầng/DB → rerun FULL suite sạch; KHÔNG test trên DB sản xuất `glb`.
> 4. **Bug = lỗi quy trình test** → thêm regression + BUGS_FIXED + đề xuất đổi quy trình; ưu tiên mở-rộng bug-class.
> 5. **Engineering PASS ≠ Production PASS (R196)** — chưa cài thật + Mr.Long nghiệm thu thì CHƯA "done"; UI đổi phải screenshot verify.
> (Chi tiết đầy đủ + checklist bug-class trong skill `glb-playbook`.)

## Nguồn sự thật (đọc trước mọi task)
1. `docs/IMS_SPEC_v1_0.md` — **SPEC CHÍNH THỨC** (Mr.Long, v1.0). Mọi feature/rule/schema/PASS gốc ở đây.
2. `bible/00_constitution.md` — hiến pháp governance + phân vai + gate.
3. `VERSION.md` — trạng thái phiên bản (so last_known_version, mismatch → re-read).
4. `BUGS_FIXED.md` — bug đã fix (đọc trước khi chạm code, không lặp lại).
5. `prompts/CMD_BUILD_*` / `prompts/CMD_AUDIT_*` — spec vai build & audit.

## Phân vai (adversarial chain — kế thừa Hắc Dạ Ký Studio)
- **LEAD** = Mr.Long — thẩm quyền DUY NHẤT (duyệt scope, ký PASS, freeze, tag, push).
- **CMD_BUILD** = agent build — implement theo spec, KHÔNG tự claim PASS.
- **CMD_AUDIT** = Claude session tổng kiểm duyệt — verify độc lập, phát verdict, không sửa code cho "xanh".

## Stack đã khóa (IMS_SPEC mục 3)
Electron · React + TypeScript · TailwindCSS · SQLite (local) · Prisma ORM · bcrypt · electron-builder (.exe) · Vitest. Future: VPS + PostgreSQL (giữ business logic, chỉ đổi datasource).

## Nguyên tắc tối thượng
- Verdict = **exit-code / bằng chứng chạy thật**, không phải lời văn.
- Check quyền bằng **permission**, KHÔNG bằng tên role (`hasPermission(user,'USER_CREATE')`, KHÔNG `user.role==='ADMIN'`).
- Mọi thao tác quan trọng: **audit log + toast + popup xác nhận có nút Hủy**. Xóa/khóa user|role: **nhập lại mật khẩu Admin**.
- Soft-delete (không xóa vật lý). Không xóa/khóa Admin cuối cùng. Không tự nâng quyền chính mình.
- Mỗi bug mới = thất bại quy trình test → thêm test/rule vào BUGS_FIXED.md.
- **Không tự claim PASS nếu chưa chạy test/build thật** (IMS_SPEC mục 21).

## Repo
GitHub slug `quan-ly-glb` (private) · tên hiển thị **Quản Lý GLB** · owner Trinhlong1988.
