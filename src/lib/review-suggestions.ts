export type ReviewQuality = {
  id: string;
  label: string;
};

export const REVIEW_QUALITIES: ReviewQuality[] = [
  { id: "quick", label: "Arrived quickly" },
  { id: "professional", label: "Friendly & professional" },
  { id: "communication", label: "Clear communication" },
  { id: "care", label: "Handled with care" },
  { id: "reassuring", label: "Made things easier" },
  { id: "handoff", label: "Smooth handoff" },
];
