// Revenue split is fixed platform-wide. Change here to change everywhere.
// 80% driver / 10% company / 10% Blue Collar AI platform.
export const SPLIT = { driver: 80, company: 10, platform: 10 } as const;

export const TIP_MIN_CENTS = 100; // $1
export const TIP_MAX_CENTS = 50000; // $500

export const PRESET_TIPS = [500, 1000, 2000, 5000];

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}