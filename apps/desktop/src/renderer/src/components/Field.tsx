import type { ReactNode } from 'react';

export function Field({
  label,
  required,
  children,
  hint
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </span>
      {children}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'rounded-md border border-line bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20';
