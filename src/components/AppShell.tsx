"use client";

import { Activity, BadgeCheck, Building2, CalendarDays, ChevronDown, CreditCard, Crown, Gem, KeyRound, LayoutDashboard, LayoutGrid, LogOut, Megaphone, Menu, ReceiptIndianRupee, ShieldCheck, UserCog, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { api } from "@/lib/client";
import type { LicenceView } from "@/lib/licence-protocol";
import { MODULE_MAP, moduleHref, moduleSections, type ModuleKey, type Role } from "@/lib/modules";
import { BrandMark } from "./BrandTheme";
import { ModuleIcon } from "./ModuleIcon";
import { ToastProvider, cx } from "./ui";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  modules: ModuleKey[];
}

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  exact?: boolean;
  /** Another path prefix that belongs to this item (a module's bespoke pages, e.g. /billing/bills/…). */
  also?: string;
  /** Module tabs, listed under the item while the module is open. */
  sections?: { key: string; label: string; group?: string }[];
}

/** How this server is deployed (see lib/deployment.ts); adds the Control Panel or licence screens. */
export interface ShellDeployment {
  mode: "standalone" | "control" | "client";
  hospitalName: string | null;
  brand?: LicenceView["brand"];
}

type Popover = "drawer" | "modules" | "account";

export function AppShell({ user, deployment, children }: { user: ShellUser; deployment?: ShellDeployment; children: ReactNode }) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const router = useRouter();
  // Menus belong to the page they were opened on, so navigating closes them.
  const [open, setOpenState] = useState<{ which: Popover; path: string } | null>(null);
  const openMenu = open?.path === pathname ? open.which : null;
  const setOpen = (which: Popover | null) => setOpenState(which ? { which, path: pathname } : null);
  const toggle = (which: Popover) => setOpen(openMenu === which ? null : which);
  const [signingOut, setSigningOut] = useState(false);
  const isSuper = user.role === "super_admin";
  // The browser's local date; nothing on the server render, so it never mismatches on hydration.
  const today = useSyncExternalStore(noopSubscribe, todayLabel, () => null);

  const primary: NavItem[] = isSuper
    ? [
        { href: "/super-admin", label: "Monitoring", icon: <LayoutDashboard className="size-4" />, exact: true },
        { href: "/super-admin/admins", label: "Admins & Access", icon: <UserCog className="size-4" /> },
        { href: "/super-admin/activity", label: "Activity Log", icon: <Activity className="size-4" /> },
        { href: "/super-admin/payments", label: "Payment Gateway", icon: <CreditCard className="size-4" /> },
        ...(deployment?.mode === "control"
          ? [
              { href: "/super-admin/clients", label: "Clients & Licences", icon: <Building2 className="size-4" /> },
              { href: "/super-admin/plans", label: "Plans & Pricing", icon: <Gem className="size-4" /> },
              { href: "/super-admin/subscriptions", label: "Licence Payments", icon: <ReceiptIndianRupee className="size-4" /> },
              { href: "/super-admin/sales", label: "Sales & Marketing", icon: <Megaphone className="size-4" /> },
            ]
          : []),
        ...(deployment?.mode === "client" ? [{ href: "/super-admin/licence", label: "Licence & Sync", icon: <BadgeCheck className="size-4" /> }] : []),
      ]
    : [{ href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" />, exact: true }];

  const modules: NavItem[] = user.modules.map((k) => ({
    href: moduleHref(k),
    also: `/${k}`,
    label: MODULE_MAP[k].label,
    icon: <ModuleIcon name={MODULE_MAP[k].icon} className="size-4" />,
    sections: moduleSections(MODULE_MAP[k]),
  }));

  const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : under(pathname, item.href) || (!!item.also && under(pathname, item.also)));

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "U";
  const subtitle = deployment?.mode === "client" && deployment.hospitalName ? deployment.hospitalName : deployment?.mode === "control" ? "Control Panel" : "Hospital ERP";
  const accountLabel = isSuper ? "Account & Password" : "Account & Razorpay";

  // Escape closes whichever menu is open.
  useEffect(() => {
    if (!openMenu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenState(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openMenu]);

  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  /* ---------- Left sidebar ---------- */

  const nav = (
    <nav className="relative flex h-full flex-col">
      {/* Soft glow behind the brand block */}
      <div className="pointer-events-none absolute -left-16 -top-24 size-64 rounded-full bg-brand-500/25 blur-3xl" aria-hidden />

      <div className="relative px-4 pb-4 pt-5">
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-3 ring-1 ring-inset ring-white/10">
          <BrandMark brand={deployment?.brand} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight text-white">{deployment?.brand?.appName ?? "MediCare"}</p>
            <p className="truncate text-[11px] leading-tight text-brand-200/90">{subtitle}</p>
          </div>
        </div>
      </div>

      <div className="relative flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:rgb(255_255_255/0.15)_transparent]">
        <NavGroup title={isSuper ? "Super Admin" : "Overview"} items={primary} isActive={isActive} />
        <NavGroup title={isSuper ? "All Modules" : "My Modules"} items={modules} isActive={isActive} tab={tabParam} empty="No modules allocated yet. Ask the super admin for access." />
      </div>

      <div className="relative border-t border-white/10 p-3">
        <NavGroup title="" items={[{ href: "/account", label: accountLabel, icon: <KeyRound className="size-4" /> }]} isActive={isActive} />
        <div className="mt-2 flex items-center gap-3 rounded-2xl bg-white/[0.06] p-2.5 ring-1 ring-inset ring-white/10">
          <Avatar initials={initials} super={isSuper} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-white">{user.name}</p>
            <p className="truncate text-[11px] leading-tight text-brand-200/80">{isSuper ? "Super Admin" : "Admin"}</p>
          </div>
          <button onClick={signOut} disabled={signingOut} title="Sign out" aria-label={signingOut ? "Signing out…" : "Sign out"} className="rounded-lg p-2 text-brand-100 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-60">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  const sidebarBg = "bg-brand-950 bg-linear-to-b from-brand-900 via-brand-950 to-slate-950";

  return (
    <ToastProvider>
      <div className="app-backdrop min-h-screen">
        <aside className={cx("fixed inset-y-0 left-0 z-30 hidden w-68 overflow-hidden border-r border-white/5 lg:block print:!hidden", sidebarBg)}>{nav}</aside>

        {openMenu === "drawer" && (
          <div className="fixed inset-0 z-40 lg:hidden print:hidden">
            <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(null)} aria-hidden />
            <aside className={cx("absolute inset-y-0 left-0 w-72 animate-slide-in overflow-hidden shadow-pop", sidebarBg)}>
              <button onClick={() => setOpen(null)} className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-brand-100 hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" />
              </button>
              {nav}
            </aside>
          </div>
        )}

        <div className="lg:pl-68 print:!pl-0">
          {/* ---------- Sticky top bar ---------- */}
          <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/80 backdrop-blur-xl backdrop-saturate-150 print:hidden">
            {/* Row 1: date, role and account */}
            <div className="flex h-14 items-center gap-3 border-b border-slate-100 px-4 sm:px-6 lg:px-8">
              <button onClick={() => toggle("drawer")} className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
                <Menu className="size-5" />
              </button>
              {today && (
                <div className="hidden min-w-0 items-center gap-2 text-sm text-slate-500 md:flex">
                  <CalendarDays className="size-4 text-brand-500" aria-hidden />
                  <span>{today}</span>
                </div>
              )}
              <div className="flex-1" />
              <span className={cx("hidden items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset sm:inline-flex", isSuper ? "bg-amber-50 text-amber-800 ring-amber-600/20" : "bg-brand-50 text-brand-700 ring-brand-600/15")}>
                {isSuper ? <Crown className="size-3.5" aria-hidden /> : <ShieldCheck className="size-3.5" aria-hidden />}
                {isSuper ? "Super Admin" : "Admin"}
              </span>
              <div className="hidden h-8 w-px bg-slate-200 sm:block" aria-hidden />

              <div className="relative shrink-0">
                <button
                  onClick={() => toggle("account")}
                  aria-expanded={openMenu === "account"}
                  aria-haspopup="menu"
                  className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-slate-100 sm:pl-3"
                >
                  <span className="hidden text-right leading-tight sm:block">
                    <span className="block max-w-44 truncate text-sm font-medium text-slate-900">{user.name}</span>
                    <span className="block max-w-44 truncate text-xs text-slate-500">{user.email}</span>
                  </span>
                  <Avatar initials={initials} super={isSuper} />
                  <ChevronDown className={cx("hidden size-4 text-slate-400 transition-transform sm:block", openMenu === "account" && "rotate-180")} aria-hidden />
                </button>
                {openMenu === "account" && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpen(null)} aria-hidden />
                    <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-72 animate-pop-in overflow-hidden rounded-2xl bg-white shadow-pop ring-1 ring-slate-900/5">
                      <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3.5">
                        <Avatar initials={initials} super={isSuper} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
                          <p className="truncate text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                      <div className="p-1.5">
                        <Link role="menuitem" href="/account" className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900">
                          <KeyRound className="size-4 text-slate-400" aria-hidden /> {accountLabel}
                        </Link>
                        <button role="menuitem" onClick={signOut} disabled={signingOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-60">
                          <LogOut className="size-4" aria-hidden /> {signingOut ? "Signing out…" : "Sign out"}
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Row 2: module strip */}
            <div className="relative">
              <div className="flex h-12 items-center gap-2 px-4 sm:px-6 lg:px-8">
                {modules.length > 0 && (
                  <>
                    <button
                      onClick={() => toggle("modules")}
                      aria-expanded={openMenu === "modules"}
                      className={cx(
                        "flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                        openMenu === "modules" ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-700 hover:bg-slate-200/80"
                      )}
                    >
                      <LayoutGrid className="size-4" aria-hidden />
                      <span className="hidden sm:inline">{isSuper ? "All modules" : "My modules"}</span>
                      <ChevronDown className={cx("size-3.5 transition-transform", openMenu === "modules" && "rotate-180")} aria-hidden />
                    </button>
                    <span className="h-5 w-px shrink-0 bg-slate-200" aria-hidden />
                  </>
                )}
                <nav className="min-w-0 flex-1" aria-label="Modules">
                  {modules.length === 0 ? (
                    <p className="text-xs text-slate-500">No modules allocated yet. Ask the super admin for access.</p>
                  ) : (
                    <ScrollRow>
                      {modules.map((item) => {
                        const active = isActive(item);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            data-active={active || undefined}
                            aria-current={active ? "page" : undefined}
                            className={cx("relative flex h-12 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors", active ? "font-medium text-brand-700" : "text-slate-600 hover:text-slate-900")}
                          >
                            <span className={cx("grid size-6 place-items-center rounded-md transition-colors", active ? "bg-brand-600 text-white shadow-sm shadow-brand-600/30 [&_svg]:size-3.5" : "text-slate-400 [&_svg]:size-4")}>{item.icon}</span>
                            {item.label}
                            {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-linear-to-r from-brand-400 to-brand-600" aria-hidden />}
                          </Link>
                        );
                      })}
                    </ScrollRow>
                  )}
                </nav>
              </div>

              {openMenu === "modules" && (
                <>
                  <div className="fixed inset-0 top-[6.5rem] z-40 animate-fade-in bg-slate-950/20 backdrop-blur-[2px] lg:left-68" onClick={() => setOpen(null)} aria-hidden />
                  <div className="absolute inset-x-0 top-full z-50 px-4 pt-2 sm:px-6 lg:px-8">
                    <div className="animate-pop-in rounded-2xl bg-white p-3 shadow-pop ring-1 ring-slate-900/5">
                      <p className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{isSuper ? "All modules" : "My modules"}</p>
                      <ul className="grid max-h-[70vh] gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                        {modules.map((item, i) => {
                          const m = MODULE_MAP[user.modules[i]];
                          const active = isActive(item);
                          return (
                            <li key={item.href}>
                              <Link href={item.href} className={cx("flex items-start gap-3 rounded-xl p-2.5 transition-colors", active ? "bg-brand-50 ring-1 ring-inset ring-brand-100" : "hover:bg-slate-50")}>
                                <span className={cx("grid size-9 shrink-0 place-items-center rounded-lg bg-linear-to-br text-white shadow-md", TILES[i % TILES.length])}>
                                  <ModuleIcon name={m.icon} className="size-4" />
                                </span>
                                <span className="min-w-0">
                                  <span className={cx("block truncate text-sm font-medium", active ? "text-brand-700" : "text-slate-900")}>{m.label}</span>
                                  <span className="line-clamp-1 text-xs text-slate-500">{m.description}</span>
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </>
              )}
            </div>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

const TILES = [
  "from-brand-400 to-brand-600 shadow-brand-600/25",
  "from-violet-400 to-indigo-600 shadow-indigo-600/25",
  "from-emerald-400 to-teal-600 shadow-teal-600/25",
  "from-amber-400 to-orange-500 shadow-orange-500/25",
  "from-rose-400 to-pink-600 shadow-pink-600/25",
  "from-sky-400 to-blue-600 shadow-blue-600/25",
];

const noopSubscribe = () => () => {};
const todayLabel = () => new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** A single row that scrolls sideways when it overflows, bringing the active link into view on navigation. */
function ScrollRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Only on navigation, so a row the user scrolled by hand is left alone.
  useEffect(() => {
    const row = ref.current;
    const active = row?.querySelector<HTMLElement>("[data-active]");
    if (!row || !active) return;
    const { left, right } = active.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    if (left < box.left || right > box.right - 32) row.scrollLeft += left - box.left - (box.width - active.offsetWidth) / 2;
  }, [pathname]);
  return (
    <div className="relative">
      <div ref={ref} className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      <span className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-white/95 to-transparent" aria-hidden />
    </div>
  );
}

function Avatar({ initials, super: isSuper }: { initials: string; super?: boolean }) {
  return (
    <span
      className={cx(
        "grid size-9 shrink-0 place-items-center rounded-full bg-linear-to-br text-xs font-semibold text-white shadow-sm ring-2 ring-white/80",
        isSuper ? "from-amber-400 to-orange-500" : "from-brand-400 to-brand-700"
      )}
      aria-hidden
    >
      {initials}
    </span>
  );
}

function NavGroup({ title, items, isActive, empty, tab }: { title: string; items: NavItem[]; isActive: (i: NavItem) => boolean; empty?: string; tab?: string | null }) {
  return (
    <div className="mt-5 first:mt-0">
      {title && <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-brand-200/60">{title}</p>}
      {items.length === 0 && empty ? <p className="px-3 py-2 text-xs text-brand-200/80">{empty}</p> : null}
      <ul className="space-y-0.5">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "group relative flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-all duration-150",
                  active
                    ? "bg-linear-to-r from-white/[0.14] to-white/[0.04] font-medium text-white shadow-sm ring-1 ring-inset ring-white/10"
                    : "text-brand-100/85 hover:bg-white/[0.07] hover:text-white"
                )}
              >
                {active && <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-300 shadow-[0_0_12px_var(--color-brand-300)]" aria-hidden />}
                <span
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-lg transition-colors",
                    active ? "bg-linear-to-br from-brand-400 to-brand-600 text-white shadow-md shadow-brand-950/40" : "bg-white/[0.06] text-brand-200 group-hover:bg-white/10 group-hover:text-white"
                  )}
                >
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
              {active && item.sections && item.sections.length > 1 && <SectionNav href={item.href} sections={item.sections} tab={tab} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The open module's tabs, grouped under small headings when the module defines groups. */
function SectionNav({ href, sections, tab }: { href: string; sections: NonNullable<NavItem["sections"]>; tab?: string | null }) {
  const current = sections.some((s) => s.key === tab) ? tab : sections[0].key;
  const groups: { name?: string; items: typeof sections }[] = [];
  for (const s of sections) {
    const last = groups[groups.length - 1];
    if (last && last.name === s.group) last.items.push(s);
    else groups.push({ name: s.group, items: [s] });
  }
  return (
    <div className="mb-2 ml-[1.35rem] mt-1.5 border-l border-white/10 pl-2.5">
      {groups.map((g, gi) => (
        <div key={gi} className={gi > 0 ? "mt-2" : undefined}>
          {g.name && <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-brand-200/60">{g.name}</p>}
          <ul className="space-y-px">
            {g.items.map((s) => (
              <li key={s.key}>
                <Link
                  href={`${href}?tab=${s.key}`}
                  aria-current={s.key === current ? "page" : undefined}
                  className={cx(
                    "relative block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                    s.key === current
                      ? "bg-white/10 font-medium text-white before:absolute before:-left-[13px] before:top-1/2 before:size-1.5 before:-translate-y-1/2 before:rounded-full before:bg-brand-300"
                      : "text-brand-100/75 hover:bg-white/[0.07] hover:text-white"
                  )}
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
