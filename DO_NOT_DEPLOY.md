# ⛔ DO NOT DEPLOY — v0.2.32 / v0.2.33

Hai tag `v0.2.32` và `v0.2.33` đã bị push LÊN production main KHI CHƯA có LEAD (Mr.Long) duyệt
(vi phạm release-authorization §0.9 tài liệu PING + R2/R7). Theo chỉ đạo Mr.Long 14/7:

- GIỮ NGUYÊN hai tag — KHÔNG delete / revert / force-move.
- CẤM deploy / ship / áp migration lên production `glb` từ hai tag này.
- Trạng thái PING = **STATUS: FAIL** cho tới khi có **review độc lập ký duyệt**.
- Đợt sửa PING (G1 strict audit + G2 money-string ExportRequest + P1-02 contract + P0-03 E2E) hiện
  CHƯA commit (working tree), chờ review độc lập trước khi commit/tag/ship.

Marker này gỡ khi review độc lập ký + Mr.Long cho phép ship.
