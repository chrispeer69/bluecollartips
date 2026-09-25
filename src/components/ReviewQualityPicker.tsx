import {
  Check,
  Gauge,
  HeartHandshake,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Smile,
  type LucideIcon,
} from "lucide-react";
import type { ReviewQuality } from "@/lib/review-suggestions";

const VISUALS: Record<string, { Icon: LucideIcon; background: string; foreground: string }> = {
  quick: { Icon: Gauge, background: "#fef3c7", foreground: "#b45309" },
  professional: { Icon: Smile, background: "#dbeafe", foreground: "#1d4ed8" },
  communication: { Icon: MessageCircle, background: "#dcfce7", foreground: "#15803d" },
  care: { Icon: ShieldCheck, background: "#fce7f3", foreground: "#be185d" },
  reassuring: { Icon: HeartHandshake, background: "#ede9fe", foreground: "#6d28d9" },
  handoff: { Icon: MapPin, background: "#cffafe", foreground: "#0e7490" },
};

export function ReviewQualityPicker({
  qualities,
  selectedIds,
  onToggle,
  brandColor,
}: {
  qualities: ReviewQuality[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  brandColor: string;
}) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-5">
      {qualities.map((quality) => {
        const selected = selectedIds.includes(quality.id);
        const visual = VISUALS[quality.id] ?? VISUALS.professional;
        const Icon = visual.Icon;
        return (
          <button
            type="button"
            key={quality.id}
            onClick={() => onToggle(quality.id)}
            aria-pressed={selected}
            className="group flex min-w-0 flex-col items-center text-center"
          >
            <span
              className="relative grid h-20 w-20 place-items-center rounded-full transition-transform group-active:scale-95"
              style={{
                background: visual.background,
                color: visual.foreground,
                boxShadow: selected ? `0 0 0 4px white, 0 0 0 7px ${brandColor}` : undefined,
              }}
            >
              <Icon className="h-9 w-9" strokeWidth={2.1} aria-hidden="true" />
              {selected && (
                <span
                  className="absolute -right-1 -top-1 grid h-7 w-7 place-items-center rounded-full text-white shadow-sm"
                  style={{ background: brandColor }}
                >
                  <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" />
                </span>
              )}
            </span>
            <span className="mt-2 text-xs font-semibold leading-tight">{quality.label}</span>
          </button>
        );
      })}
    </div>
  );
}
