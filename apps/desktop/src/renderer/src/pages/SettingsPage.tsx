import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { AuthUser } from '@glb/shared';
import { hasPermission } from '@glb/shared';
import type { SettingDto } from '../../../preload/index.d';
import { useToast } from '../lib/toast.js';
import { Field, inputCls } from '../components/Field.js';

const DEFAULT_KEYS: { key: string; label: string }[] = [
  { key: 'company_name', label: 'Tên công ty' },
  { key: 'backup_dir_note', label: 'Ghi chú thư mục backup' }
];

export function SettingsPage({ user }: { user: AuthUser }): JSX.Element {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const canUpdate = hasPermission(user, 'SYSTEM_SETTING_UPDATE');

  useEffect(() => {
    window.api.settingList().then((res) => {
      if (res.ok && res.data) {
        const map: Record<string, string> = {};
        (res.data as SettingDto[]).forEach((s) => (map[s.key] = s.value ?? ''));
        setValues(map);
      } else if (res.message) {
        toast.error(res.message);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(key: string): Promise<void> {
    setSavingKey(key);
    const res = await window.api.settingUpdate(key, values[key] ?? '');
    setSavingKey(null);
    if (res.ok) toast.success('Đã lưu cấu hình');
    else toast.error(res.message ?? 'Lưu cấu hình thất bại');
  }

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Cài đặt</h2>
        <p className="text-sm text-slate-500">Cấu hình hệ thống. Mọi thay đổi được ghi vào nhật ký (SETTING_UPDATED).</p>
      </div>

      <div className="max-w-xl rounded-xl border border-line bg-white p-6 shadow-sm">
        {loading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
        {!loading && (
          <div className="space-y-4">
            {DEFAULT_KEYS.map((k) => (
              <div key={k.key} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label={k.label}>
                    <input
                      className={inputCls}
                      value={values[k.key] ?? ''}
                      disabled={!canUpdate}
                      onChange={(e) => setValues((v) => ({ ...v, [k.key]: e.target.value }))}
                    />
                  </Field>
                </div>
                {canUpdate && (
                  <button
                    onClick={() => save(k.key)}
                    disabled={savingKey === k.key}
                    className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
                  >
                    {savingKey === k.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Lưu
                  </button>
                )}
              </div>
            ))}
            {!canUpdate && <p className="text-sm text-slate-400">Bạn chỉ có quyền xem cấu hình.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
