"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Ban, BookOpenCheck, Briefcase, Building2, CalendarPlus, ChevronDown, CircleHelp, ClipboardList, FileSignature, FileSpreadsheet, LayoutDashboard, LayoutPanelTop, ListChecks, MonitorSmartphone, ShieldCheck, Siren, Star, UserCheck, Users, type LucideIcon } from "lucide-react";
import { Icon } from "@/components/Icon";

/** Icons by name: server components pass names (functions cannot cross into a client component). */
const ICONS = { home: LayoutDashboard, visits: ClipboardList, invite: CalendarPlus, approvals: UserCheck, approvalsAlt: BookOpenCheck, frequent: Star, evacuation: Siren, setup: Building2, sites: Building2, policies: ShieldCheck, forms: LayoutPanelTop, nda: FileSignature, people: Users, companies: Briefcase, blacklist: Ban, kiosks: MonitorSmartphone, reports: FileSpreadsheet, help: CircleHelp, passes: ListChecks } satisfies Record<string, LucideIcon>;
export type MenuIcon = keyof typeof ICONS;

export type MenuItem = { href: string; label: string; icon: MenuIcon; description?: string };
/** A top-level entry: a direct link, or a section whose items open in a dropdown. */
export type MenuSection = { key: string; label: string; icon: MenuIcon; href?: string; items?: MenuItem[] };

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin" || href === "/app") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Panel menu: sections with dropdowns (Visitas, Configuración, Personas…) plus direct links, the current page's
 * section highlighted. One dropdown open at a time; closes on Escape, on a click outside and after choosing a link.
 * On narrow screens the sections wrap onto several rows.
 */
export function MenuBar({ sections, label }: { sections: MenuSection[]; label: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(null);
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav ref={ref} aria-label={label} className="relative mb-6 print:hidden" data-testid="menu-bar">
      <ul className="flex flex-wrap gap-1 rounded-xl border border-border bg-surface p-1">
        {sections.map((s) => {
          const active = s.href ? isActive(pathname, s.href) : (s.items ?? []).some((i) => isActive(pathname, i.href));
          const cls = `inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? "bg-primary text-primary-contrast" : "text-text hover:bg-surface-2"}`;
          if (s.href) {
            return (
              <li key={s.key}>
                <Link href={s.href} className={cls} aria-current={active ? "page" : undefined} data-testid={`menu-${s.key}`}>
                  <Icon icon={ICONS[s.icon]} size={16} /> {s.label}
                </Link>
              </li>
            );
          }
          const expanded = open === s.key;
          return (
            <li key={s.key} className="relative">
              <button
                type="button"
                className={cls}
                aria-haspopup="menu"
                aria-expanded={expanded}
                aria-controls={`menu-${s.key}-panel`}
                data-testid={`menu-${s.key}`}
                onClick={() => setOpen(expanded ? null : s.key)}
              >
                <Icon icon={ICONS[s.icon]} size={16} /> {s.label} <Icon icon={ChevronDown} size={14} className={`transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded ? (
                <ul
                  id={`menu-${s.key}-panel`}
                  role="menu"
                  className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-1 shadow-lg"
                  data-testid={`menu-${s.key}-panel`}
                >
                  {(s.items ?? []).map((i) => {
                    const current = isActive(pathname, i.href);
                    return (
                      <li key={i.href} role="none">
                        <Link
                          href={i.href}
                          role="menuitem"
                          aria-current={current ? "page" : undefined}
                          className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm ${current ? "bg-surface-2 font-medium" : "hover:bg-surface-2"}`}
                          onClick={() => setOpen(null)}
                        >
                          <span className="mt-0.5 shrink-0 text-text-muted"><Icon icon={ICONS[i.icon]} size={16} /></span>
                          <span className="min-w-0">
                            <span className="block">{i.label}</span>
                            {i.description ? <span className="block text-xs text-text-muted">{i.description}</span> : null}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
