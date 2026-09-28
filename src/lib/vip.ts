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
  /** Review date (YYYY-MM-DD, company local time). */
  review_day: string;
  assignee_id: string | null;
  assignee_name: string | null;
  /** Assigned directly to this customer, or inherited from the day. */
  assignee_source: "customer" | "day" | null;
  /** Scheduled next follow-up call (YYYY-MM-DD), if any. */
  next_followup_on: string | null;
  call_count: number;
};

export type VipStage = "registered" | "clicked" | "link_sent" | "no_link";

/** Where the lead sits on the path to Convini registration, and what to do next. */
/** Today's date as YYYY-MM-DD in the viewer's time zone. */
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export type FollowupState = "overdue" | "due" | "scheduled" | null;
export function followupState(nextOn: string | null | undefined, today = todayYmd()): FollowupState {
  if (!nextOn) return null;
  return nextOn < today ? "overdue" : nextOn === today ? "due" : "scheduled";
}

export function vipNextStep(row: Pick<VipReportRow, "stars" | "google_posted_at" | "convini_link_sent_at" | "convini_clicked_at" | "convini_registered_at"> & Partial<Pick<VipReportRow, "next_followup_on">>): { stage: VipStage; action: string } {
  const base = vipStageStep(row);
  const due = followupState(row.next_followup_on);
  if (due === "overdue" || due === "due") return { stage: base.stage, action: `Follow-up call ${due === "due" ? "due today" : "overdue"}. ${base.action}` };
  return base;
}

function vipStageStep(row: Pick<VipReportRow, "stars" | "google_posted_at" | "convini_link_sent_at" | "convini_clicked_at" | "convini_registered_at">): { stage: VipStage; action: string } {
  const google = row.stars >= 4 && !row.google_posted_at ? " Ask for a Google review." : "";
  if (row.convini_registered_at) return { stage: "registered", action: `Registered — welcome them as a VIP.${google}` };
  if (row.convini_clicked_at) return { stage: "clicked", action: `HOT: opened the Convini link but hasn't registered — call and help them sign up.${google}` };
  if (row.convini_link_sent_at) return { stage: "link_sent", action: `Got the link, hasn't opened it — resend or call.${google}` };
  return { stage: "no_link", action: `Convini link not sent yet — send it.${google}` };
}

/**
 * Follow-up progress by logged calls: red = needs the first call, yellow = one
 * call done (one more to go), green = two calls done, finished.
 */
export type FollowupProgress = "needs_first" | "followed_once" | "done";
export const FOLLOWUP_CALLS_TO_FINISH = 2;
export function followupProgress(callCount: number): FollowupProgress {
  if (callCount >= FOLLOWUP_CALLS_TO_FINISH) return "done";
  return callCount >= 1 ? "followed_once" : "needs_first";
}
