export type SessionNotice = {
  event: "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED" | "USER_UPDATED" | "PASSWORD_RECOVERY";
  identity: string | null;
};
export type SessionChannel = {
  publish(notice: SessionNotice): void;
  subscribe(callback: (notice: SessionNotice) => void): () => void;
};
export function createBrowserSessionChannel(key: string): SessionChannel & { close(): void } {
  const channel = new BroadcastChannel(key + ":hafiz-session-notice-v1");
  const callbacks = new Set<(notice: SessionNotice) => void>();
  channel.onmessage = (message: MessageEvent<unknown>) => {
    const value = message.data;
    if (!value || typeof value !== "object" || !("event" in value) || !("identity" in value)) return;
    const event = value.event;
    const identity = value.identity;
    if (
      event !== "SIGNED_IN" &&
      event !== "SIGNED_OUT" &&
      event !== "TOKEN_REFRESHED" &&
      event !== "USER_UPDATED" &&
      event !== "PASSWORD_RECOVERY"
    )
      return;
    if (identity !== null && (typeof identity !== "string" || identity.length > 256)) return;
    if ((event === "SIGNED_OUT") !== (identity === null)) return;
    for (const callback of callbacks) callback({ event, identity });
  };
  return {
    publish: (notice) => channel.postMessage(notice),
    subscribe: (callback) => {
      callbacks.add(callback);
      return () => {
        callbacks.delete(callback);
      };
    },
    close: () => {
      callbacks.clear();
      channel.close();
    },
  };
}
