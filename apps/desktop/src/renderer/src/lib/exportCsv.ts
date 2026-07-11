// XUẤT EXCEL (R38/R39 Mr.Long 11/7) — GIỮ NGUYÊN chữ ký exportCsv(filename, headers, rows, title?) để 28 nơi
// gọi KHÔNG phải sửa, nhưng bên trong nay đi qua IPC dựng .xlsx THẬT chuẩn nhà GLOBEWAY (exceljs, main process)
// → LƯU qua hộp thoại HĐH (chọn nơi lưu) → hỏi "Mở / Không mở" (hộp thoại DÙNG CHUNG). Không còn .xls-HTML giả.
import { getDialogBridge } from './dialogBridge.js';

type Cell = string | number | null | undefined;

// Khóa kỹ thuật (filename cũ) → tên tiếng Việt chuẩn để đặt tên file + tiêu đề bảng (sẽ IN HOA).
const NAME_MAP: Record<string, string> = {
  ngan_hang: 'Danh sách ngân hàng',
  loai_the: 'Danh sách loại thẻ',
  doi_tac: 'Danh sách đối tác',
  bieu_phi: 'Bảng biểu phí',
  loai_phi: 'Danh sách loại phí',
  nha_cung_cap: 'Danh sách nhà cung cấp',
  chung_loai_pos: 'Danh sách chủng loại máy POS',
  trang_thai_nhap: 'Danh sách trạng thái nhập máy',
  nhap_kho_pos: 'Danh sách máy POS nhập kho',
  nguon_tk: 'Danh sách nguồn tài khoản nhận tiền',
  tk_nhan_tien: 'Danh sách tài khoản nhận tiền',
  nguon_ho_so: 'Danh sách nguồn hồ sơ',
  ho_so_hkd: 'Danh sách hồ sơ HKD',
  trang_thai_tid: 'Danh sách trạng thái TID',
  cau_hinh_tid: 'Danh sách cấu hình TID',
  nganh_nghe: 'Danh sách ngành nghề',
  danh_muc_thu_chi: 'Danh mục thu chi',
  quy: 'Danh sách quỹ',
  bao_cao_thu_chi: 'Báo cáo thu chi',
  khach_hang: 'Danh sách khách hàng',
  nhan_su: 'Danh sách nhân sự',
  vai_tro: 'Danh sách vai trò',
  nhat_ky: 'Nhật ký hệ thống',
  thung_rac: 'Thùng rác',
  doanh_thu: 'Báo cáo doanh thu',
  cong_no: 'Báo cáo công nợ',
  xep_hang_doanh_so_tid: 'Xếp hạng doanh số TID',
  duyet_huy_bill: 'Danh sách duyệt hủy bill'
};

// Biến filename kỹ thuật lạ ("abc_xyz") thành tên đẹp ("Abc xyz") khi không có trong NAME_MAP.
function prettify(filename: string): string {
  const base = filename.replace(/\.(csv|xls|xlsx)$/i, '').replace(/[_-]+/g, ' ').trim();
  if (!base) return 'Bảng dữ liệu';
  return base.charAt(0).toUpperCase() + base.slice(1);
}
function todayStamp(): string {
  const d = new Date();
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; // ví dụ 11.7.2026 (không thêm số 0)
}

/**
 * Xuất bảng ra Excel .xlsx chuẩn nhà. `filename` = khóa kỹ thuật cũ (tra NAME_MAP ra tên Việt); `title`
 * (nếu truyền) ưu tiên làm tiêu đề bảng (ví dụ báo cáo dòng lỗi). Bất đồng bộ nhưng nơi gọi onClick khỏi await.
 */
export async function exportCsv(filename: string, headers: string[], rows: Cell[][], title?: string): Promise<void> {
  const dlg = getDialogBridge();
  const fileBase = NAME_MAP[filename] ?? title ?? prettify(filename);
  const reportTitle = title ?? NAME_MAP[filename] ?? prettify(filename);
  const fileName = `${fileBase} ${todayStamp()}.xlsx`;
  let res;
  try {
    res = await window.api.reportExport({ kind: 'report', fileBase, fileName, title: reportTitle, headers, rows });
  } catch (e) {
    return dlg.alert('Không xuất được Excel: ' + (e instanceof Error ? e.message : String(e)), 'Xuất Excel thất bại');
  }
  if (!res.ok) return dlg.alert(res.message ?? 'Không xuất được Excel.', 'Xuất Excel thất bại');
  if (res.canceled || !res.path) return; // người dùng bấm Hủy ở hộp thoại lưu — im lặng.
  const open = await dlg.confirm(`Đã lưu tại:\n${res.path}\n\nMở file ngay bây giờ?`, { title: 'Xuất Excel thành công', okLabel: 'Mở file', cancelLabel: 'Không mở' });
  if (open) {
    const o = await window.api.openFilePath(res.path);
    if (!o.ok) dlg.alert(o.message ?? 'Không mở được file.', 'Không mở được file');
  }
}
