import { createLatestValueSender } from "@/lib/reflections/latest-value";

type Call = { value: boolean; resolve: () => void; reject: (error: Error) => void };

function harness(confirmed = false) {
  const calls: Call[] = [];
  let current = true;
  const settled = jest.fn(),
    failed = jest.fn();
  const sender = createLatestValueSender<boolean>({
    confirmed,
    send: (value) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
    isCurrent: () => current,
    onSettled: settled,
    onFailed: failed,
  });
  return {
    sender,
    calls,
    settled,
    failed,
    retire: () => {
      current = false;
    },
  };
}
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe("latest-value sender", () => {
  it("sends the first choice at once and folds a burst of taps into one follow-up", async () => {
    const { sender, calls, settled } = harness(false);
    sender.want(true);
    sender.want(false);
    sender.want(true);
    sender.want(false);
    expect(calls.map((call) => call.value)).toEqual([true]);
    expect(sender.isBusy()).toBe(true);
    calls[0].resolve();
    await flush();
    // The server holds true; the latest choice is false, so one more request follows.
    expect(calls.map((call) => call.value)).toEqual([true, false]);
    calls[1].resolve();
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith(false);
    expect(sender.isBusy()).toBe(false);
  });

  it("sends nothing more when the burst ends on the value the server just accepted", async () => {
    const { sender, calls, settled } = harness(false);
    sender.want(true);
    sender.want(false);
    sender.want(true);
    calls[0].resolve();
    await flush();
    expect(calls).toHaveLength(1);
    expect(settled).toHaveBeenCalledWith(true);
  });

  it("reports the last accepted value after a failure and drops the rest of the burst", async () => {
    const { sender, calls, settled, failed } = harness(false);
    sender.want(true);
    sender.want(false);
    calls[0].resolve();
    await flush();
    calls[1].reject(new Error("synthetic failure"));
    await flush();
    expect(failed).toHaveBeenCalledWith(true, expect.any(Error));
    expect(settled).not.toHaveBeenCalled();
    // A later tap starts from the accepted value.
    sender.want(false);
    expect(calls.map((call) => call.value)).toEqual([true, false, false]);
  });

  it("stops and reports nothing once it is no longer current", async () => {
    const { sender, calls, settled, failed, retire } = harness(false);
    sender.want(true);
    sender.want(false);
    retire();
    calls[0].resolve();
    await flush();
    expect(calls).toHaveLength(1);
    expect(settled).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });
});
