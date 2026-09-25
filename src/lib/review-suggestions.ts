export type ReviewQuality = {
  id: string;
  label: string;
  phrase: string;
};

export const REVIEW_QUALITIES: ReviewQuality[] = [
  { id: "quick", label: "Arrived quickly", phrase: "arrived quickly" },
  {
    id: "professional",
    label: "Friendly & professional",
    phrase: "was friendly and professional",
  },
  {
    id: "communication",
    label: "Clear communication",
    phrase: "communicated clearly throughout the service",
  },
  {
    id: "care",
    label: "Handled with care",
    phrase: "handled my vehicle with care",
  },
  {
    id: "reassuring",
    label: "Made things easier",
    phrase: "made a stressful situation easier",
  },
  {
    id: "handoff",
    label: "Smooth handoff",
    phrase: "made the pickup and drop-off smooth",
  },
];

export function composeReviewSentence(subject: string, selectedIds: string[]) {
  const selected = REVIEW_QUALITIES.filter((quality) => selectedIds.includes(quality.id));
  if (!selected.length) return "";
  const phrases = selected.map((quality) => quality.phrase);
  if (phrases.length === 1) return `${subject} ${phrases[0]}.`;
  if (phrases.length === 2) return `${subject} ${phrases[0]} and ${phrases[1]}.`;
  return `${subject} ${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}.`;
}
