import { useState, type ReactNode } from "react";
import { LogOut, Menu, X, type LucideIcon } from "lucide-react";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronsUpDown } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";

export type DashboardNavItem<T extends string> = {
  id: T;
  label: string;
  icon: LucideIcon;
  group?: string;
  badge?: number;
};

export function WorkspaceSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string; detail?: string }[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option.value === value) ?? options[0];
  const initials = selected?.label.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "BC";
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="mt-2 flex w-full items-center gap-2 rounded-lg outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label="Select workspace">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-bold text-primary-foreground">{initials}</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm font-semibold">{selected?.label}</span>
          {selected?.detail && <span className="block truncate text-[11px] text-muted-foreground">{selected.detail}</span>}
        </span>
        <Select.Icon><ChevronsUpDown size={16} className="text-muted-foreground" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={8}
          align="start"
          className="z-[100] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          <Select.Viewport>
            {options.map((option) => {
              const optionInitials = option.label.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
              return (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2.5 pl-2 pr-9 outline-none data-[highlighted]:bg-sidebar-accent data-[state=checked]:bg-primary/8"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-[10px] font-bold text-muted-foreground">{optionInitials}</span>
                  <span className="min-w-0 flex-1">
                    <Select.ItemText><span className="block truncate text-sm font-medium">{option.label}</span></Select.ItemText>
                    {option.detail && <span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>}
                  </span>
                  <Select.ItemIndicator className="absolute right-3 text-secondary"><Check size={17} strokeWidth={2.5} /></Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

export function BrandedQRCode({
  value,
  size,
  logoUrl,
  id,
  includeMargin = true,
}: {
  value: string;
  size: number;
  logoUrl?: string | null;
  id?: string;
  includeMargin?: boolean;
}) {
  return (
    <QRCodeCanvas
      id={id}
      value={value}
      size={size}
      includeMargin={includeMargin}
      level={logoUrl ? "H" : "M"}
      imageSettings={logoUrl ? {
        src: logoUrl,
        height: Math.round(size * 0.2),
        width: Math.round(size * 0.2),
        excavate: true,
        crossOrigin: "anonymous",
      } : undefined}
    />
  );
}

export function DashboardShell<T extends string>({
  title,
  subtitle,
  pageTitle,
  active,
  items,
  workspace,
  onChange,
  onSignOut,
  children,
}: {
  title: string;
  subtitle: string;
  pageTitle: string;
  active: T;
  items: DashboardNavItem<T>[];
  workspace?: ReactNode;
  onChange: (id: T) => void;
  onSignOut: () => void | Promise<void>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const choose = (id: T) => { onChange(id); setOpen(false); };
  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        <a href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">BC</span>
          <span>Blue Collar Tips</span>
        </a>
        <button className="rounded-md p-2 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      {workspace && <div className="border-b border-sidebar-border p-3">{workspace}</div>}
      <nav className="flex-1 overflow-y-auto p-3">
        {items.map((item, index) => {
          const priorGroup = index ? items[index - 1].group : undefined;
          return (
            <div key={item.id}>
              {item.group && item.group !== priorGroup && (
                <div className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground first:mt-1">{item.group}</div>
              )}
              <button
                onClick={() => choose(item.id)}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${active === item.id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground"}`}
              >
                <item.icon size={18} className={active === item.id ? "text-secondary" : ""} />
                <span className="flex-1">{item.label}</span>
                {!!item.badge && <span className="rounded-full bg-destructive px-2 py-0.5 text-[10px] text-white">{item.badge}</span>}
              </button>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground">
          <LogOut size={18} /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/45">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-sidebar-border lg:block">{sidebar}</aside>
      {open && <div className="fixed inset-0 z-40 bg-black/35 lg:hidden" onClick={() => setOpen(false)}><aside className="h-full w-[min(19rem,88vw)]" onClick={(e) => e.stopPropagation()}>{sidebar}</aside></div>}
      <div className="lg:ml-72">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card px-4 sm:px-6">
          <button className="rounded-md border border-border p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={18} /></button>
          <div className="min-w-0">
            <div className="truncate text-xs text-muted-foreground">{subtitle} · {title}</div>
            <h1 className="truncate text-lg font-semibold">{pageTitle}</h1>
          </div>
        </header>
        <main className="p-4 sm:p-6">
          <div className="mx-auto max-w-7xl space-y-5">{children}</div>
        </main>
      </div>
    </div>
  );
}
