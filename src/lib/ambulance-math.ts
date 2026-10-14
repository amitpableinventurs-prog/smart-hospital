/**
 * Ambulance trip charges from a tariff. Shared by the server (authoritative)
 * and the completion dialog (live preview), so both always agree.
 */

export interface Tariff {
  name: string;
  baseFare: number;
  includedKm?: number | null;
  perKmRate: number;
  freeWaitingMinutes?: number | null;
  waitingPerHour?: number | null;
  nightSurchargePct?: number | null;
  oxygenCharge?: number | null;
  ventilatorCharge?: number | null;
}

export interface TripCharges {
  base: number;
  distance: number;
  waiting: number;
  night: number;
  equipment: number;
  discount: number;
  total: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Dispatches between 10 pm and 6 am (hospital local time) carry the night surcharge. */
export function isNight(at: Date) {
  const h = at.getHours();
  return h >= 22 || h < 6;
}

export function tripCharges(
  t: Tariff,
  input: { distanceKm: number; waitingMinutes: number; night: boolean; oxygen: boolean; ventilator: boolean; discount: number }
): TripCharges {
  const base = r2(t.baseFare);
  const extraKm = Math.max(0, input.distanceKm - (t.includedKm ?? 0));
  const distance = r2(extraKm * t.perKmRate);
  // Waiting is charged per started half hour beyond the free period.
  const extraWait = Math.max(0, input.waitingMinutes - (t.freeWaitingMinutes ?? 0));
  const waiting = r2((Math.ceil(extraWait / 30) / 2) * (t.waitingPerHour ?? 0));
  const night = input.night ? r2(((base + distance) * (t.nightSurchargePct ?? 0)) / 100) : 0;
  const equipment = r2((input.oxygen ? (t.oxygenCharge ?? 0) : 0) + (input.ventilator ? (t.ventilatorCharge ?? 0) : 0));
  const gross = r2(base + distance + waiting + night + equipment);
  const discount = r2(Math.min(Math.max(0, input.discount), gross));
  return { base, distance, waiting, night, equipment, discount, total: r2(gross - discount) };
}

/** Bill lines for the charge heads that apply (discount reduces the first line). */
export function chargeLines(c: TripCharges, t: { name: string; distanceKm: number }) {
  const lines = [
    { name: `Ambulance – ${t.name}`, detail: "Base fare", amount: c.base },
    { name: "Ambulance – distance", detail: `${t.distanceKm} km`, amount: c.distance },
    { name: "Ambulance – waiting", detail: "", amount: c.waiting },
    { name: "Ambulance – night surcharge", detail: "", amount: c.night },
    { name: "Ambulance – oxygen / equipment", detail: "", amount: c.equipment },
  ].filter((l) => l.amount > 0);
  let discount = c.discount;
  for (const l of lines) {
    const cut = Math.min(l.amount, discount);
    l.amount = r2(l.amount - cut);
    if (cut) l.detail = `${l.detail ? `${l.detail} · ` : ""}less discount ₹${cut}`;
    discount = r2(discount - cut);
  }
  return lines.filter((l) => l.amount > 0);
}
