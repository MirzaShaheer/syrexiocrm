/**
 * Stage pipelines live in code, not in the database.
 * A contract's pipeline is determined by its account's niche.
 */

export const NICHES = ["web_development", "ebook_design", "graphic_design"] as const;
export type Niche = (typeof NICHES)[number];

export type Stage = { key: string; label: string };

export const PIPELINES: Record<Niche, readonly Stage[]> = {
  web_development: [
    { key: "scoping", label: "Scoping" },
    { key: "building", label: "Building" },
    { key: "internal_review", label: "Internal review" },
    { key: "client_review", label: "Client review" },
    { key: "revisions", label: "Revisions" },
    { key: "delivered", label: "Delivered" },
  ],
  ebook_design: [
    { key: "manuscript_received", label: "Manuscript received" },
    { key: "layout", label: "Layout" },
    { key: "proofing", label: "Proofing" },
    { key: "client_review", label: "Client review" },
    { key: "revisions", label: "Revisions" },
    { key: "delivered", label: "Delivered" },
  ],
  graphic_design: [
    { key: "brief", label: "Brief" },
    { key: "concepts", label: "Concepts" },
    { key: "client_review", label: "Client review" },
    { key: "revisions", label: "Revisions" },
    { key: "final_files", label: "Final files" },
  ],
} as const;

export const NICHE_LABELS: Record<Niche, string> = {
  web_development: "Web development",
  ebook_design: "Ebook design",
  graphic_design: "Graphic design",
};

export function stagesFor(niche: Niche): readonly Stage[] {
  return PIPELINES[niche];
}

export function isValidStage(niche: Niche, stageKey: string): boolean {
  return PIPELINES[niche].some((s) => s.key === stageKey);
}

export function stageLabel(niche: Niche, stageKey: string): string {
  return PIPELINES[niche].find((s) => s.key === stageKey)?.label ?? stageKey;
}

/** First stage of a pipeline — what a newly synced contract lands on. */
export function firstStage(niche: Niche): string {
  return PIPELINES[niche][0].key;
}

/** Terminal stage — work is done, so some alert rules stop applying. */
export function isTerminalStage(niche: Niche, stageKey: string): boolean {
  const stages = PIPELINES[niche];
  return stages[stages.length - 1].key === stageKey;
}
