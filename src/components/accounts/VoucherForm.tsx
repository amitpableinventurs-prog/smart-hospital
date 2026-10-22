"use client";

import { ArrowLeft, Plus, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VOUCHER_TYPES } from "@/lib/accounts-shared";
import { r2 } from "@/lib/billing-math";
import { ApiClientError, api } from "@/lib/client";
import { formatMoney } from "@/lib/format";
import { RefSelect, type RefOption } from "../RecordForm";
import { Alert, Button, Card, CardHeader, Field, Kbd, PageHeader, cx, errorRing, inputClass, useHotkeys, useToast } from "../ui";
import { VOUCHER_KEYS, type Voucher } from "./types";

const ledgerField = { name: "ledger", label: "Ledger", type: "ref" as const, ref: "accounts.ledgers", required: true };

interface Line {
  key: number;
  ledger: string;
  ref?: RefOption;
  side: "Dr" | "Cr";
  amount: string;
  note: string;
}

/** Usual first line of each voucher type (the cash / bank side). */
const FIRST_SIDE: Record<string, "Dr" | "Cr"> = { Receipt: "Dr", Payment: "Dr", Contra: "Dr", Journal: "Dr", Sales: "Dr", Purchase: "Dr", "Credit Note": "Dr", "Debit Note": "Dr" };

const HELP: Record<string, string> = {
  Receipt: "Money received: debit the cash / bank ledger, credit the party or income.",
  Payment: "Money paid out: debit the expense or party, credit the cash / bank ledger.",
  Contra: "Cash deposited in or withdrawn from a bank, or a transfer between bank accounts.",
  Journal: "Adjustments without cash or bank: depreciation, provisions, transfers between ledgers.",
  Sales: "A sale entered directly in Accounts (patient bills and pharmacy sales post automatically).",
  Purchase: "A purchase or expense bill entered directly (pharmacy purchases and GRNs post automatically). Debit Input CGST / SGST / IGST to claim GST credit.",
  "Credit Note": "Reduces what a customer owes (sales return, allowance).",
  "Debit Note": "Reduces what you owe a supplier (purchase return, rate difference).",
};

let seq = 0;
const blank = (side: "Dr" | "Cr"): Line => ({ key: ++seq, ledger: "", side, amount: "", note: "" });

/** Enter or edit a manual voucher, Tally style: Dr / Cr lines that must balance. */
export function VoucherForm({ voucher, initialType }: { voucher?: Voucher; initialType?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState(voucher?.type ?? ((VOUCHER_TYPES as readonly string[]).includes(initialType ?? "") ? initialType! : "Payment"));
  const [date, setDate] = useState(voucher?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState(voucher?.narration ?? "");
  const [refNo, setRefNo] = useState(voucher?.refNo ?? "");
  const [lines, setLines] = useState<Line[]>(() =>
    voucher
      ? voucher.entries.map((e) => ({ key: ++seq, ledger: e.ledgerId, ref: { id: e.ledgerId, label: e.ledger }, side: e.dr > 0 ? "Dr" : "Cr", amount: String(e.dr || e.cr), note: e.note }))
      : [blank(FIRST_SIDE[type] ?? "Dr"), blank(FIRST_SIDE[type] === "Cr" ? "Dr" : "Cr")]
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dr = r2(lines.reduce((s, l) => s + (l.side === "Dr" ? Number(l.amount) || 0 : 0), 0));
  const cr = r2(lines.reduce((s, l) => s + (l.side === "Cr" ? Number(l.amount) || 0 : 0), 0));
  const diff = r2(dr - cr);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** Put the difference on the last line, or on a new line on the short side. */
  function balance() {
    if (diff === 0) return;
    setLines((ls) => {
      const side: "Dr" | "Cr" = diff > 0 ? "Cr" : "Dr";
      const last = ls[ls.length - 1];
      if (last && last.side === side && !Number(last.amount)) return ls.map((l) => (l.key === last.key ? { ...l, amount: String(Math.abs(diff)) } : l));
      return [...ls, { ...blank(side), amount: String(Math.abs(diff)) }];
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    setErrors({});
    const body = {
      type, date, narration, refNo,
      entries: lines.filter((l) => l.ledger || Number(l.amount)).map((l) => ({ ledger: l.ledger, dr: l.side === "Dr" ? Number(l.amount) || 0 : 0, cr: l.side === "Cr" ? Number(l.amount) || 0 : 0, note: l.note })),
    };
    try {
      const { data } = voucher ? await api<Voucher>(`/api/accounts/vouchers/${voucher.id}`, { method: "PUT", body }) : await api<Voucher>("/api/accounts/vouchers", { method: "POST", body });
      toast(voucher ? `Voucher ${data.code} updated` : `Voucher ${data.code} saved`);
      router.push(`/accounts/vouchers/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiClientError && e.fields) setErrors(e.fields);
      setBusy(false);
    }
  }

  const hotkeys: Record<string, () => void> = { "ctrl+s": save, F10: save, "ctrl+b": balance };
  if (!voucher) for (const [t, k] of Object.entries(VOUCHER_KEYS)) hotkeys[k] = () => setType(t);
  useHotkeys(hotkeys);

  return (
    <>
      <PageHeader
        title={voucher ? `Edit ${voucher.type} voucher ${voucher.code}` : `New ${type} voucher`}
        description={HELP[type]}
        actions={<Link href={voucher ? `/accounts/vouchers/${voucher.id}` : "/m/accounts?tab=daybook"}><Button variant="secondary"><ArrowLeft className="size-4" /> Back</Button></Link>}
      />
      {!voucher && (
        <div className="mb-4 flex flex-wrap gap-2">
          {VOUCHER_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} className={cx("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ring-1", t === type ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50")}>
              {t} {VOUCHER_KEYS[t] && <Kbd>{VOUCHER_KEYS[t]}</Kbd>}
            </button>
          ))}
        </div>
      )}
      <Card>
        <CardHeader title="Voucher" />
        <div className="space-y-4 p-5">
          {error && <Alert>{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" htmlFor="v-date" required error={errors.date}>
              <input id="v-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cx(inputClass, errorRing(errors.date))} />
            </Field>
            <Field label={type === "Purchase" || type === "Debit Note" ? "Supplier invoice no." : "Reference (cheque / UTR / bill no.)"} htmlFor="v-ref">
              <input id="v-ref" value={refNo} maxLength={60} onChange={(e) => setRefNo(e.target.value)} className={inputClass} />
            </Field>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="w-20 py-2 pr-2">Dr / Cr</th>
                  <th className="py-2 pr-2">Ledger</th>
                  <th className="w-40 py-2 pr-2 text-right">Debit</th>
                  <th className="w-40 py-2 pr-2 text-right">Credit</th>
                  <th className="py-2 pr-2">Line note</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="align-top">
                    <td className="py-1.5 pr-2">
                      <select value={l.side} onChange={(e) => update(l.key, { side: e.target.value as "Dr" | "Cr" })} className={inputClass} aria-label="Debit or credit">
                        <option>Dr</option>
                        <option>Cr</option>
                      </select>
                    </td>
                    <td className="min-w-64 py-1.5 pr-2">
                      <RefSelect id={`v-l-${l.key}`} field={ledgerField} value={l.ledger} initial={l.ref} onChange={(v) => update(l.key, { ledger: v })} onPick={(o) => update(l.key, { ref: o ?? undefined })} className={cx(inputClass, errorRing(errors[`entries.${i}`]))} />
                      {errors[`entries.${i}`] && <p className="mt-1 text-xs text-red-600">{errors[`entries.${i}`]}</p>}
                    </td>
                    {(["Dr", "Cr"] as const).map((side) => (
                      <td key={side} className="py-1.5 pr-2">
                        {l.side === side ? (
                          <input type="number" min={0} step="0.01" inputMode="decimal" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} className={cx(inputClass, "text-right tabular-nums")} aria-label={`${side === "Dr" ? "Debit" : "Credit"} amount`} />
                        ) : (
                          <div className="px-3 py-2 text-right text-slate-300">—</div>
                        )}
                      </td>
                    ))}
                    <td className="py-1.5 pr-2">
                      <input value={l.note} maxLength={200} onChange={(e) => update(l.key, { note: e.target.value })} className={inputClass} aria-label="Line note" />
                    </td>
                    <td className="py-1.5">
                      <button type="button" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30" aria-label="Remove line">
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 font-semibold">
                  <td colSpan={2} className="py-2 pr-2">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="ghost" onClick={() => setLines((ls) => [...ls, blank(diff > 0 ? "Cr" : "Dr")])}><Plus className="size-4" /> Add line</Button>
                      <Button type="button" variant="ghost" onClick={balance} disabled={diff === 0}><Scale className="size-4" /> Balance <Kbd>Ctrl+B</Kbd></Button>
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(dr)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{formatMoney(cr)}</td>
                  <td colSpan={2} className={cx("py-2 text-sm", diff === 0 ? "text-emerald-700" : "text-red-600")}>{diff === 0 ? (dr > 0 ? "Balanced" : "") : `Difference ${formatMoney(Math.abs(diff))} ${diff > 0 ? "Dr" : "Cr"}`}</td>
                </tr>
              </tfoot>
            </table>
            {errors.entries && <p className="mt-2 text-sm text-red-600">{errors.entries}</p>}
          </div>

          <Field label="Narration" htmlFor="v-narr">
            <textarea id="v-narr" rows={2} maxLength={500} value={narration} onChange={(e) => setNarration(e.target.value)} className={inputClass} placeholder="e.g. Electricity bill for September paid by NEFT" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={save} loading={busy} disabled={diff !== 0 || dr <= 0}>{voucher ? "Save changes" : "Save voucher"} <Kbd>Ctrl+S</Kbd></Button>
          </div>
        </div>
      </Card>
    </>
  );
}
