export function isMissingPublicReviewAggregateError(error: { code?: string; message?: string; details?: string } | null): boolean {
  const message = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
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
