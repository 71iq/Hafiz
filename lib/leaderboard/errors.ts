export function isMissingPublicReviewAggregateError(error: unknown): boolean {
  const field = (key: "code" | "message" | "details") => {
    if (!error || typeof error !== "object") return "";
    const value: unknown = Reflect.get(error, key);
    return value == null ? "" : String(value);
  };
  const message = `${field("code")} ${field("message")} ${field("details")}`.toLowerCase();
  return (
    message.includes("public_review_activity") ||
    message.includes("public_review_stats")
  ) && (
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("pgrst205") ||
    message.includes("42p01")
  );
}
