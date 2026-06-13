export type RtlContractType =
  | "direction-neutral"
  | "app-shell"
  | "tab-segmented"
  | "overlay"
  | "button"
  | "form-field"
  | "card"
  | "quran-text"
  | "picker-menu"
  | "feedback"
  | "progress-chart"
  | "mushaf-reading"
  | "media-preview";

export type RtlTestLevel = "source" | "rntl" | "playwright" | "manual";

export type RtlComponentRegistryEntry = {
  path: string;
  contract: RtlContractType;
  testLevel: RtlTestLevel;
  notes: string;
};

