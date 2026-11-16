"use client";

import { ChevronLeft, ChevronRight, CircleCheck, Inbox, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Paged } from "@/lib/client";

/** Copy of `obj` without `key` (e.g. to clear one field error). */
export function omitKey<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const next = { ...obj };
  delete next[key];
  return next;
}

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------- Buttons ---------- */

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-linear-to-b from-brand-500 to-brand-600 text-white shadow-sm shadow-brand-900/20 ring-1 ring-inset ring-white/10 hover:from-brand-600 hover:to-brand-700",
  secondary: "bg-white text-slate-700 shadow-xs ring-1 ring-inset ring-slate-200 hover:bg-slate-50 hover:ring-slate-300",
  danger: "bg-linear-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-900/20 hover:from-red-600 hover:to-red-700",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-60",
        variants[variant],
        className
      )}
    >
      {loading && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/* ---------- Layout bits ---------- */

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[1.65rem]">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-2xl border border-slate-200/80 bg-white shadow-card print:shadow-none", className)}>{children}</div>;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 [&_h2]:tracking-tight">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = "brand" }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: "brand" | "amber" | "red" | "slate" }) {
  const tones = {
    brand: "from-brand-400 to-brand-600 shadow-brand-600/25",
    amber: "from-amber-400 to-orange-500 shadow-amber-500/25",
    red: "from-rose-400 to-red-600 shadow-red-600/25",
    slate: "from-slate-400 to-slate-600 shadow-slate-600/25",
  };
  const glows = { brand: "bg-brand-400/15", amber: "bg-amber-400/15", red: "bg-red-400/15", slate: "bg-slate-400/15" };
  return (
    <Card className="relative overflow-hidden p-5">
      <div className={cx("pointer-events-none absolute -right-8 -top-10 size-32 rounded-full blur-2xl print:hidden", glows[tone])} aria-hidden />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
        {icon && <div className={cx("rounded-xl bg-linear-to-br p-2.5 text-white shadow-lg [&_svg]:text-white", tones[tone])}>{icon}</div>}
      </div>
    </Card>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-brand-50 text-brand-700 ring-brand-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap [&:has(>svg)>.badge-dot]:hidden", badgeTones[tone])}>
      <span className="badge-dot size-1.5 shrink-0 rounded-full bg-current opacity-70 print:hidden" aria-hidden />
      {children}
    </span>
  );
}

/** Map common status words to a badge tone. */
export function statusTone(value: string): keyof typeof badgeTones {
  const v = value.toLowerCase();
  // Checked in order: "unpaid" / "inactive" must not fall through to "paid" / "active".
  if (/(unpaid|partial|refund due)/.test(v)) return "amber";
  if (/(cancel|rejected|absent|no-show|resigned|inactive|maintenance|^stat$|fail|out of stock|out of order|expired|critical)/.test(v)) return "red";
  if (/(completed|paid|approved|settled|active|available|discharged|on duty|reported|verified|pass|in stock|working)/.test(v)) return "green";
  if (/(pending|waiting|review|requested|urgent|on leave|on trip|transferred|warning|low stock|sent out|result entered|abnormal)/.test(v)) return "amber";
  if (/(ipd|admitted|in progress|in consultation|dispatched|sample|in process|collected|received)/.test(v)) return "violet";
  return "blue";
}

/* ---------- Form controls ---------- */

export const inputClass =
  "block w-full rounded-xl border-0 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs ring-1 ring-inset ring-slate-200 outline-none transition-shadow placeholder:text-slate-400 hover:ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-brand-500)_15%,transparent)] disabled:bg-slate-50 disabled:text-slate-500";

export function Field({ label, htmlFor, required, error, hint, className, children }: { label: string; htmlFor: string; required?: boolean; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-red-600">*</span> : <span className="ml-1 text-xs font-normal text-slate-400">(optional)</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function errorRing(error?: string) {
  return error ? "ring-red-400 focus:ring-red-500" : "";
}

/* ---------- States ---------- */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500" role="status">
      <LoaderCircle className="size-5 animate-spin text-brand-600" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="rounded-2xl bg-linear-to-br from-brand-50 to-slate-100 p-4 ring-1 ring-inset ring-slate-200/70">
        <Inbox className="size-6 text-brand-500" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center" role="alert">
      <div className="rounded-2xl bg-red-50 p-4 ring-1 ring-inset ring-red-100">
        <TriangleAlert className="size-6 text-red-500" aria-hidden />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-900">Couldn&apos;t load data</p>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = "red", children }: { tone?: "red" | "amber" | "green"; children: ReactNode }) {
  const t = { red: "bg-red-50 text-red-800 ring-red-200", amber: "bg-amber-50 text-amber-900 ring-amber-200", green: "bg-emerald-50 text-emerald-800 ring-emerald-200" };
  return <div className={cx("rounded-xl px-4 py-3 text-sm ring-1 ring-inset", t[tone])} role={tone === "red" ? "alert" : "status"}>{children}</div>;
}

/* ---------- Pagination ---------- */

export function Pagination({ pagination, onPage }: { pagination?: Paged; onPage: (p: number) => void }) {
  if (!pagination || pagination.total === 0) return null;
  const { page, totalPages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
      <span>
        Showing <span className="font-medium tabular-nums">{from}–{to}</span> of <span className="font-medium tabular-nums">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" className="px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" />
        </Button>
        <span className="tabular-nums px-1">
          {page} / {totalPages}
        </span>
        <Button variant="ghost" className="px-2" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({ open, onClose, title, description, children, footer, size = "lg" }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; size?: "md" | "lg" | "xl" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  const widths = { md: "max-w-md", lg: "max-w-2xl", xl: "max-w-4xl" };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/45 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cx("relative flex max-h-[92vh] w-full animate-pop-in flex-col rounded-t-3xl bg-white shadow-pop ring-1 ring-slate-900/5 sm:rounded-2xl", widths[size])}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 rounded-b-2xl border-t border-slate-100 bg-slate-50/70 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", danger, loading, error, onConfirm, onClose }: { open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; loading?: boolean; error?: string | null; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-slate-600">
        <div>{message}</div>
        {error && <Alert>{error}</Alert>}
      </div>
    </Modal>
  );
}

/* ---------- Toasts ---------- */

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
}
const ToastCtx = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto flex animate-pop-in items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-pop ring-1", t.tone === "success" ? "bg-white/95 text-slate-800 ring-slate-200 backdrop-blur" : "bg-red-600 text-white ring-red-700")}>
            {t.tone === "success" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ---------- Hooks ---------- */

/** Debounce a value, e.g. a search box, before sending it to the API. */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ---------- Keyboard shortcuts ---------- */

function comboOf(e: KeyboardEvent) {
  const printable = e.key.length === 1;
  return [e.ctrlKey || e.metaKey ? "ctrl" : "", e.altKey ? "alt" : "", e.shiftKey && !printable ? "shift" : "", printable ? e.key.toLowerCase() : e.key]
    .filter(Boolean)
    .join("+");
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * Marg-style hotkeys, e.g. { F2: newBill, "ctrl+s": save, F10: save }.
 * Function keys and ctrl/alt combos work while typing; plain characters do not.
 */
export function useHotkeys(bindings: Record<string, (e: KeyboardEvent) => void>, enabled = true) {
  const ref = useRef(bindings);
  useEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      const fn = ref.current[combo];
      if (!fn) return;
      if (combo.length === 1 && isTyping(e.target)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("rounded border border-current/25 bg-black/5 px-1 py-px font-mono text-[10px] font-medium leading-none opacity-80", className)}>
      {children}
    </kbd>
  );
}
