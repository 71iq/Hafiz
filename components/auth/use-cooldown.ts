import { useCallback, useEffect, useState } from "react";

/**
 * A seconds countdown for resend and retry cooldowns. The deadline is the single source of truth;
 * the remaining value is derived from it on each tick, so a late tick never extends the wait.
 */
export function useCooldown(now: () => number = Date.now) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const remaining = deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now()) / 1000));

  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => {
      if (now() >= deadline) {
        setDeadline(null);
        clearInterval(timer);
      } else {
        setTick((value) => value + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, now]);

  const start = useCallback(
    (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds <= 0) return;
      setDeadline((current) => Math.max(current ?? 0, now() + Math.ceil(seconds) * 1000));
    },
    [now],
  );

  return { remaining, active: remaining > 0, start };
}

/** Seconds a successful email send blocks the same action, matching the provider's own limit. */
export const EMAIL_RESEND_COOLDOWN_SECONDS = 60;
