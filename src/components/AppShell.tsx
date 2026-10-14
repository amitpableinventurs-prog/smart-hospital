"use client";

import { Activity, Crown, Hospital, KeyRound, LayoutDashboard, LogOut, Menu, UserCog, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { api } from "@/lib/client";
import { MODULE_MAP, moduleHref, moduleSections, type ModuleKey, type Role } from "@/lib/modules";
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
  /** Module tabs, listed under the item while the module is open. */
  sections?: { key: string; label: string; group?: string }[];
}

export function AppShell({ user, children }: { user: ShellUser; children: ReactNode }) {
  const pathname = usePathname();
  const tabParam = useSearchParams().get("tab");
  const router = useRouter();
  // The mobile drawer belongs to the page it was opened on, so navigating closes it.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const mobileOpen = drawerPath === pathname;
  const setMobileOpen = (open: boolean) => setDrawerPath(open ? pathname : null);
  const [signingOut, setSigningOut] = useState(false);
  const isSuper = user.role === "super_admin";

  const primary: NavItem[] = isSuper
    ? [
        { href: "/super-admin", label: "Monitoring", icon: <LayoutDashboard className="size-4" />, exact: true },
        { href: "/super-admin/admins", label: "Admins & Access", icon: <UserCog className="size-4" /> },
        { href: "/super-admin/activity", label: "Activity Log", icon: <Activity className="size-4" /> },
      ]
    : [{ href: "/dashboard", label: "Dashboard", icon: <LayoutDashboard className="size-4" />, exact: true }];

  const modules: NavItem[] = user.modules.map((k) => ({
    href: moduleHref(k),
    label: MODULE_MAP[k].label,
    icon: <ModuleIcon name={MODULE_MAP[k].icon} className="size-4" />,
    sections: moduleSections(MODULE_MAP[k]),
  }));

  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/"));

  async function signOut() {
    setSigningOut(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="rounded-lg bg-brand-600 p-1.5 text-white">
          <Hospital className="size-5" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold leading-tight text-white">MediCare</p>
          <p className="text-[11px] leading-tight text-brand-200">Hospital ERP</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4">
        <NavGroup title={isSuper ? "Super Admin" : "Overview"} items={primary} isActive={isActive} />
        <NavGroup title={isSuper ? "All Modules" : "My Modules"} items={modules} isActive={isActive} tab={tabParam} empty="No modules allocated yet. Ask the super admin for access." />
      </div>

      <div className="border-t border-white/10 p-3">
        <NavGroup title="" items={[{ href: "/account", label: "Account & Password", icon: <KeyRound className="size-4" /> }]} isActive={isActive} />
        <button onClick={signOut} disabled={signingOut} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-100 hover:bg-white/10 hover:text-white disabled:opacity-60">
          <LogOut className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </nav>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-brand-900 lg:block print:!hidden">{nav}</aside>

        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} aria-hidden />
            <aside className="absolute inset-y-0 left-0 w-72 bg-brand-900 shadow-xl">
              <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 rounded p-1 text-brand-100 hover:bg-white/10" aria-label="Close menu">
                <X className="size-5" />
              </button>
              {nav}
            </aside>
          </div>
        )}

        <div className="lg:pl-64 print:!pl-0">
          <header className="sticky top-0 z-20 flex h-16 print:hidden items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
            <button onClick={() => setMobileOpen(true)} className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-slate-900">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", isSuper ? "bg-amber-100 text-amber-800" : "bg-brand-50 text-brand-700")}>
                {isSuper && <Crown className="size-3.5" aria-hidden />}
                {isSuper ? "Super Admin" : "Admin"}
              </span>
            </div>
          </header>
          <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8 print:max-w-none print:p-0">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}

function NavGroup({ title, items, isActive, empty, tab }: { title: string; items: NavItem[]; isActive: (i: NavItem) => boolean; empty?: string; tab?: string | null }) {
  return (
    <div className="mt-4 first:mt-0">
      {title && <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-brand-200/70">{title}</p>}
      {items.length === 0 && empty ? <p className="px-3 py-2 text-xs text-brand-200/80">{empty}</p> : null}
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={cx(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                isActive(item) ? "bg-white/15 font-medium text-white" : "text-brand-100 hover:bg-white/10 hover:text-white"
              )}
            >
              {item.icon}
              {item.label}
            </Link>
            {isActive(item) && item.sections && item.sections.length > 1 && <SectionNav href={item.href} sections={item.sections} tab={tab} />}
          </li>
        ))}
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
    <div className="mb-2 ml-5 mt-1 border-l border-white/15 pl-2">
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
                    "block rounded-md px-2 py-1.5 text-[13px] transition-colors",
                    s.key === current ? "bg-white/15 font-medium text-white" : "text-brand-100/90 hover:bg-white/10 hover:text-white"
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
