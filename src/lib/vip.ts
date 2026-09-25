// Shared (client + server) pieces of the VIP customer follow-up report.

export const VIP_EVENTS = [
  "convini_link_sent",
  "convini_clicked",
  "convini_registered",
  "google_clicked",
  "google_review_posted",
] as const;
export type VipEvent = (typeof VIP_EVENTS)[number];

export type VipReportRow = {
  rating_id: string;
  job_id: string;
  ghl_contact_id: string | null;
  review_requested_at: string;
  reviewed_at: string;
  stars: number;
  feedback: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  driver_id: string | null;
  driver_name: string | null;
  tip_count: number;
  tip_total_cents: number;
  tip_first_at: string | null;
  tip_refunded: boolean;
  google_clicked_at: string | null;
  google_posted_at: string | null;
  google_stars: number | null;
  convini_link_sent_at: string | null;
  convini_link_last_sent_at: string | null;
  convini_link_sent_count: number;
  convini_clicked_at: string | null;
  convini_last_clicked_at: string | null;
  convini_click_count: number;
  convini_registered_at: string | null;
  convini_registered_source: string | null;
  contacted_at: string | null;
  notes: string | null;
};

export type VipStage = "registered" | "clicked" | "link_sent" | "no_link";

/** Where the lead sits on the path to Convini registration, and what to do next. */
export function vipNextStep(row: Pick<VipReportRow, "stars" | "google_posted_at" | "convini_link_sent_at" | "convini_clicked_at" | "convini_registered_at">): { stage: VipStage; action: string } {
  const google = row.stars >= 4 && !row.google_posted_at ? " Ask for a Google review." : "";
  if (row.convini_registered_at) return { stage: "registered", action: `Registered — welcome them as a VIP.${google}` };
  if (row.convini_clicked_at) return { stage: "clicked", action: `HOT: opened the Convini link but hasn't registered — call and help them sign up.${google}` };
  if (row.convini_link_sent_at) return { stage: "link_sent", action: `Got the link, hasn't opened it — resend or call.${google}` };
  return { stage: "no_link", action: `Convini link not sent yet — send it.${google}` };
}
