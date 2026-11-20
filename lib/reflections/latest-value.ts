/**
 * Sends the latest wanted value of an absolute setting, such as a like, one request at a time.
 *
 * The screen shows each tap at once. Taps made while a request runs only move the wanted value;
 * when that request settles, the next one sends whatever is wanted then, so a burst of taps costs
 * at most one request after the first and the server ends on the last choice. A failure drops the
 * wanted value and reports the last value the server confirmed, so the screen can show it again.
 * Nothing is reported once `isCurrent` turns false (another account, or a newer sender).
 */
export type LatestValueSender<T> = {
  want: (value: T) => void;
  isBusy: () => boolean;
};

export function createLatestValueSender<T>({
  confirmed: initial,
  send,
  isCurrent,
  onSettled,
  onFailed,
}: {
  /** The value the server holds before the first send. */
  confirmed: T;
  send: (value: T) => Promise<void>;
  isCurrent: () => boolean;
  /** Every wanted value reached the server; `confirmed` is what it holds now. */
  onSettled: (confirmed: T) => void;
  /** A send failed; `confirmed` is the last value the server accepted. */
  onFailed: (confirmed: T, error: unknown) => void;
}): LatestValueSender<T> {
  let confirmed = initial;
  let wanted = initial;
  let busy = false;

  const pump = async () => {
    busy = true;
    try {
      while (!Object.is(wanted, confirmed)) {
        if (!isCurrent()) return;
        const sending = wanted;
        await send(sending);
        confirmed = sending;
      }
    } catch (error) {
      wanted = confirmed;
      if (isCurrent()) onFailed(confirmed, error);
      return;
    } finally {
      busy = false;
    }
    if (isCurrent()) onSettled(confirmed);
  };

  return {
    want(value) {
      wanted = value;
      if (!busy) void pump();
    },
    isBusy: () => busy,
  };
}
