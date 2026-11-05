import { processLock } from "@supabase/supabase-js";
// Keep the SDK's registry promise fulfilled while preserving the caller's rejection.
export async function safeProcessLock<T>(name: string, timeout: number, work: () => Promise<T>): Promise<T> {
  const outcome = await processLock(name, timeout, async () => {
    try {
      return { ok: true as const, value: await work() };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
