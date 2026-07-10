import { useEffect, useMemo, useState } from 'react';
import {
  X, Mail, MailOpen, Send, PenSquare, CheckCheck, RefreshCw, ShieldAlert, Inbox, ArrowLeft, Loader2
} from 'lucide-react';
import type { MessageDto, UserDto } from '../../../preload/index.d';
import { Button } from './Button.js';
import { Field, inputCls } from './Field.js';
import { useToast } from '../lib/toast.js';

function fmtFull(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtShort(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, '0');
  const today = new Date();
  const sameDay = d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
  return sameDay ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

/**
 * Hòm thư nội bộ kiểu email (Nhóm A #2 + Nhóm C #7): 2 khung danh sách ↔ nội dung.
 * - Thông báo bảo mật (kind=SYSTEM) hiển thị nhãn riêng.
 * - Soạn thư gửi người dùng khác (nếu có quyền gửi).
 * - Đọc thư → tự đánh dấu đã đọc; "Đánh dấu tất cả đã đọc".
 */
export function MessagesDrawer({
  canSend,
  onClose,
  onChanged
}: {
  canSend: boolean;
  onClose: () => void;
  onChanged?: () => void;
}): JSX.Element {
  const toast = useToast();
  const [rows, setRows] = useState<MessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<'read' | 'compose'>('read');

  async function reload(): Promise<void> {
    const res = await window.api.messageInbox();
    if (res.ok && res.data) setRows(res.data);
    setLoading(false);
    onChanged?.();
  }
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);
  const unread = rows.filter((r) => r.readAt === null).length;

  async function open(m: MessageDto): Promise<void> {
    setMode('read');
    setSelectedId(m.id);
    if (m.readAt === null) {
      await window.api.messageMarkRead(m.id);
      setRows((prev) => prev.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)));
      onChanged?.();
    }
  }
  async function markAll(): Promise<void> {
    await window.api.messageMarkAllRead();
    setRows((prev) => prev.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    onChanged?.();
    toast.success('Đã đánh dấu tất cả là đã đọc.');
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-gradient-to-r from-brand to-brand-hover px-5 py-3.5 text-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20"><Inbox className="h-5 w-5" /></div>
            <div>
              <h3 className="text-base font-semibold leading-tight">Hòm thư nội bộ</h3>
              <p className="text-xs text-white/80">{unread > 0 ? `${unread} thư chưa đọc` : 'Đã đọc hết'}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {canSend && (
              <button onClick={() => { setMode('compose'); setSelectedId(null); }} className="flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-1.5 text-sm font-medium hover:bg-white/25">
                <PenSquare className="h-4 w-4" /> Soạn thư
              </button>
            )}
            <button onClick={markAll} title="Đánh dấu tất cả đã đọc" className="rounded-lg p-2 hover:bg-white/15"><CheckCheck className="h-4 w-4" /></button>
            <button onClick={reload} title="Tải lại" className="rounded-lg p-2 hover:bg-white/15"><RefreshCw className="h-4 w-4" /></button>
            <button onClick={onClose} title="Đóng" className="rounded-lg p-2 hover:bg-white/15"><X className="h-5 w-5" /></button>
          </div>
        </div>

        {/* Body: 2 khung */}
        <div className="flex min-h-0 flex-1">
          {/* Danh sách */}
          <div className="w-80 shrink-0 overflow-y-auto border-r border-line bg-appbg/40">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Đang tải…</div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-slate-400">
                <Inbox className="h-10 w-10" />
                <p className="text-sm">Hòm thư trống.</p>
              </div>
            ) : (
              rows.map((m) => {
                const isUnread = m.readAt === null;
                const isSystem = m.kind === 'SYSTEM';
                const active = m.id === selectedId && mode === 'read';
                return (
                  <button
                    key={m.id}
                    onClick={() => open(m)}
                    className={
                      'flex w-full items-start gap-2.5 border-b border-line px-3.5 py-3 text-left transition ' +
                      (active ? 'bg-brand-tint' : 'hover:bg-white')
                    }
                  >
                    <span className={'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' + (isSystem ? 'bg-warning/15 text-warning' : isUnread ? 'bg-brand/15 text-brand' : 'bg-slate-100 text-slate-400')}>
                      {isSystem ? <ShieldAlert className="h-4 w-4" /> : isUnread ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={'truncate text-sm ' + (isUnread ? 'font-semibold text-slate-800' : 'font-medium text-slate-600')}>{m.senderName ?? 'Không rõ'}</span>
                        <span className="shrink-0 text-[11px] text-slate-400">{fmtShort(m.createdAt)}</span>
                      </span>
                      <span className={'block truncate text-[13px] ' + (isUnread ? 'font-medium text-slate-700' : 'text-slate-500')}>{m.subject}</span>
                      <span className="block truncate text-xs text-slate-400">{m.body}</span>
                    </span>
                    {isUnread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
                  </button>
                );
              })
            )}
          </div>

          {/* Nội dung / Soạn thư */}
          <div className="min-w-0 flex-1 overflow-y-auto">
            {mode === 'compose' ? (
              <ComposeForm onClose={() => setMode('read')} onSent={reload} />
            ) : selected ? (
              <div className="p-6">
                <button onClick={() => setSelectedId(null)} className="mb-4 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 lg:hidden"><ArrowLeft className="h-3.5 w-3.5" /> Danh sách</button>
                <div className="mb-1 flex items-center gap-2">
                  {selected.kind === 'SYSTEM' && <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning"><ShieldAlert className="h-3 w-3" /> Thông báo hệ thống</span>}
                </div>
                <h2 className="text-lg font-semibold text-slate-800">{selected.subject}</h2>
                <div className="mt-2 flex items-center gap-2 border-b border-line pb-4 text-sm text-slate-500">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-tint text-xs font-semibold text-brand">{(selected.senderName ?? '?').charAt(0).toUpperCase()}</span>
                  <span><span className="font-medium text-slate-700">{selected.senderName ?? 'Không rõ'}</span> · {fmtFull(selected.createdAt)}</span>
                </div>
                <div className="whitespace-pre-wrap pt-4 text-[15px] leading-relaxed text-slate-700">{selected.body}</div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
                <MailOpen className="h-14 w-14" />
                <p className="text-sm">Chọn một thư để đọc.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposeForm({ onClose, onSent }: { onClose: () => void; onSent: () => void }): JSX.Element {
  const toast = useToast();
  const [users, setUsers] = useState<UserDto[]>([]);
  const [recipientId, setRecipientId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.userList({}).then((r) => {
      if (r.ok && r.data) setUsers(r.data);
    });
  }, []);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!recipientId) return toast.alert('Vui lòng chọn người nhận.');
    setBusy(true);
    try {
      const res = await window.api.messageSend({ recipientId: Number(recipientId), subject, body });
      if (res.ok) {
        toast.success('Đã gửi thư.');
        onSent();
        onClose();
      } else {
        toast.alert(res.message ?? 'Gửi thư thất bại.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center gap-2">
        <button type="button" onClick={onClose} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"><ArrowLeft className="h-3.5 w-3.5" /> Quay lại</button>
        <h2 className="text-lg font-semibold text-slate-800">Soạn thư mới</h2>
      </div>
      <div className="flex flex-col gap-4">
        <Field label="Người nhận" required>
          <select className={inputCls} value={recipientId} onChange={(e) => setRecipientId(e.target.value)} autoFocus>
            <option value="">— Chọn người nhận —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName} ({u.username})</option>
            ))}
          </select>
        </Field>
        <Field label="Tiêu đề" required>
          <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Tiêu đề thư" />
        </Field>
        <Field label="Nội dung" required>
          <textarea className={inputCls + ' min-h-[180px] resize-y'} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Nhập nội dung thư…" />
        </Field>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="neutral" onClick={onClose}>Hủy</Button>
        <Button type="submit" variant="confirm" disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>Gửi thư</Button>
      </div>
    </form>
  );
}
