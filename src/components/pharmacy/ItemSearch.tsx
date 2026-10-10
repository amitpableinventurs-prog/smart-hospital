"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import { api } from "@/lib/client";
import { formatDate, formatMoney } from "@/lib/format";
import { cx, inputClass, useDebounced } from "../ui";

export interface StockBatch {
  id: string;
  batchNo: string;
  expiryDate: string | null;
  expired: boolean;
  quantity: number;
  mrp: number;
  gstRate: number;
}

export interface StockItem {
  id: string;
  name: string;
  sku: string | null;
  manufacturer: string | null;
  gstRate: number;
  mrp: number | null;
  lastRate: number | null;
  stock: number;
  batches: StockBatch[];
}

type Option = { item: StockItem; batch?: StockBatch; disabled: boolean; key: string };

/**
 * Keyboard-first item finder. Type, use ↑/↓, press Enter.
 * "sale" mode lists sellable batches (earliest expiry first); "purchase" mode lists items.
 */
export function ItemSearch({ mode, onPick, inputRef, placeholder }: { mode: "sale" | "purchase"; onPick: (item: StockItem, batch?: StockBatch) => void; inputRef?: Ref<HTMLInputElement>; placeholder?: string }) {
  const [q, setQ] = useState("");
  const debounced = useDebounced(q, 200);
  const [results, setResults] = useState<{ q: string; items: StockItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    api<StockItem[]>(`/api/pharmacy/stock?q=${encodeURIComponent(debounced)}`, { signal: ctrl.signal })
      .then(({ data }) => {
        setResults({ q: debounced, items: data });
        setError(null);
      })
      .catch((e) => (e as Error).name !== "AbortError" && setError((e as Error).message));
    return () => ctrl.abort();
  }, [debounced, open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const options = useMemo<Option[]>(() => {
    const items = results?.items ?? [];
    if (mode === "purchase") return items.map((item) => ({ item, disabled: false, key: item.id }));
    return items.flatMap((item): Option[] =>
      item.batches.length === 0
        ? [{ item, disabled: true, key: item.id }]
        : item.batches.map((batch) => ({ item, batch, disabled: batch.expired, key: batch.id }))
    );
  }, [results, mode]);

  const loading = open && results?.q !== debounced;
  const firstEnabled = options.findIndex((o) => !o.disabled);
  const current = options[active]?.disabled ? firstEnabled : active;

  function pick(o: Option | undefined) {
    if (!o || o.disabled) return;
    onPick(o.item, o.batch);
    setQ("");
    setActive(0);
    setOpen(false);
  }

  function move(delta: number) {
    if (options.length === 0) return;
    let i = current < 0 ? 0 : current;
    for (let n = 0; n < options.length; n++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
    listRef.current?.children[i]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div ref={wrap} className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => q && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); move(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
          else if (e.key === "Enter") { e.preventDefault(); pick(options[current]); }
          else if (e.key === "Escape") { setOpen(false); setQ(""); }
        }}
        placeholder={placeholder ?? "Search item by name, code or manufacturer…"}
        className={cx(inputClass, "pl-9")}
        role="combobox"
        aria-expanded={open}
        aria-controls="item-search-list"
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg bg-white shadow-xl ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
            <span>↑ ↓ to move · Enter to add · Esc to close</span>
            {loading && <LoaderCircle className="size-3.5 animate-spin" />}
          </div>
          <ul id="item-search-list" ref={listRef} role="listbox" className="max-h-80 overflow-y-auto text-sm">
            {error && <li className="px-3 py-2 text-red-600">{error}</li>}
            {!error && !loading && options.length === 0 && (
              <li className="px-3 py-3 text-slate-500">No items found. Add items in Inventory → Item Master{mode === "sale" ? ", then stock them via a purchase entry" : ""}.</li>
            )}
            {options.map((o, i) => (
              <li
                key={o.key}
                role="option"
                aria-selected={i === current}
                aria-disabled={o.disabled}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                className={cx("grid grid-cols-12 items-center gap-2 px-3 py-1.5", o.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer", i === current && !o.disabled && "bg-brand-50")}
              >
                <span className="col-span-5 truncate">
                  <span className="font-medium text-slate-900">{o.item.name}</span>
                  {o.item.sku && <span className="ml-1.5 font-mono text-[11px] text-slate-500">{o.item.sku}</span>}
                </span>
                {mode === "sale" ? (
                  o.batch ? (
                    <>
                      <span className="col-span-2 truncate font-mono text-xs text-slate-600">{o.batch.batchNo}</span>
                      <span className={cx("col-span-2 text-xs", o.batch.expired ? "font-medium text-red-600" : "text-slate-600")}>
                        {o.batch.expired ? "EXPIRED" : `Exp ${formatDate(o.batch.expiryDate)}`}
                      </span>
                      <span className="col-span-1 text-right text-xs tabular-nums text-slate-600">{o.batch.quantity}</span>
                      <span className="col-span-2 text-right text-xs tabular-nums text-slate-900">{formatMoney(o.batch.mrp)}</span>
                    </>
                  ) : (
                    <span className="col-span-7 text-xs font-medium text-red-600">No stock — make a purchase entry first</span>
                  )
                ) : (
                  <>
                    <span className="col-span-3 truncate text-xs text-slate-500">{o.item.manufacturer ?? ""}</span>
                    <span className="col-span-2 text-right text-xs tabular-nums text-slate-600">Stock {o.item.stock}</span>
                    <span className="col-span-2 text-right text-xs text-slate-600">GST {o.item.gstRate}%</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
