import { useState } from 'react';
import { parsePartialDate, splitIsoDate } from '@glb/shared';
import { inputCls } from './Field.js';

/**
 * Ô nhập ngày dd/mm/yyyy dùng chung (FIX 1a — form nhập kho POS).
 * GIỮ state TỪNG PHẦN nội bộ: gõ ngày trước KHÔNG bị wipe khi chưa đủ tháng/năm.
 * Chỉ emit onChange('yyyy-mm-dd') khi đủ 3 phần hợp lệ; emit '' khi chưa đủ / sai
 * (để form biết chưa hợp lệ). Ngày local (B16) — không đụng timezone.
 *
 * Khởi tạo 1 lần từ `value` (chế độ sửa). Component được mount mới mỗi lần mở form
 * nên không cần đồng bộ ngược khi `value` đổi từ ngoài.
 */
export function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  const init = splitIsoDate(value);
  const [d, setD] = useState(init.d);
  const [m, setM] = useState(init.m);
  const [y, setY] = useState(init.y);
  const [error, setError] = useState<string | null>(null);

  function emit(nd: string, nm: string, ny: string): void {
    const r = parsePartialDate(nd, nm, ny);
    setError(r.error);
    onChange(r.value ?? '');
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          className={inputCls + ' w-16 text-center'}
          placeholder="Ngày"
          inputMode="numeric"
          maxLength={2}
          value={d}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setD(v); emit(v, m, y); }}
        />
        <span className="text-slate-400">/</span>
        <input
          className={inputCls + ' w-16 text-center'}
          placeholder="Tháng"
          inputMode="numeric"
          maxLength={2}
          value={m}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 2); setM(v); emit(d, v, y); }}
        />
        <span className="text-slate-400">/</span>
        <input
          className={inputCls + ' w-20 text-center'}
          placeholder="Năm"
          inputMode="numeric"
          maxLength={4}
          value={y}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setY(v); emit(d, m, v); }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
