export const TIP_MIN_CENTS = 100; // $1
export const TIP_MAX_CENTS = 50000; // $500

export const PRESET_TIPS = [500, 1000, 2000];

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
