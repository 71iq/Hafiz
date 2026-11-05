import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import { useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isEmailAuthFlowsEnabled } from "@/lib/auth/config";
import { preparePasswordRecovery, finishPasswordRecovery, useAuthStore } from "@/lib/auth/store";
import { authCommands } from "@/lib/auth/commands";
import type { AuthOwner } from "@/lib/auth/coordinator";

type RecoveryState =
  | { kind: "idle" | "preparing" | "invalid" | "superseded" | "saving" | "signing-out" | "finished" }
  | { kind: "failed"; error: unknown }
  | { kind: "ready"; error: unknown | null };
type Operation = {
  id: number;
  active: boolean;
  inputHash: string;
  started: boolean;
  tokens: { access_token: string; refresh_token: string } | undefined;
  owner: AuthOwner | null;
  busy: boolean;
  intentIsCurrent: () => boolean;
};
const Context = createContext<{
  state: RecoveryState;
  formKey: number;
  submit(password: string): Promise<void>;
  attach(): void;
  leave(): void;
} | null>(null);
const isResetPath = (path: string) => path.replace(/\/+$/, "") === "/auth/reset-password";

// Keep recovery above the database/audio Stack replacement. The form can remount without
// replaying credentials or losing the synchronous submission guard.
export function PasswordRecoveryProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const router = useRouter();
  const [attachments, setAttachments] = useState(0);
  const attach = useCallback(() => setAttachments((value) => value + 1), []);
  const initialized = useAuthStore((value) => value.isInitialized);
  const operation = useRef<Operation | null>(null);
  const nextOperation = useRef(0);
  const expectedOperation = operation.current;
  const currentPath = useRef(pathname);
  const [state, setState] = useState<RecoveryState>({ kind: "idle" });
  const configured = isSupabaseConfigured() && isEmailAuthFlowsEnabled();
  const cancel = useCallback(() => {
    const current = operation.current;
    operation.current = null;
    if (current) {
      current.active = false;
      current.owner?.cancel();
      current.tokens = undefined;
      current.inputHash = "";
    }
  }, []);
  const leave = useCallback(() => {
    if (expectedOperation && operation.current === expectedOperation) {
      cancel();
      setState({ kind: "idle" });
    }
  }, [cancel, expectedOperation]);
  const isActive = useCallback(
    (current: Operation) =>
      operation.current === current &&
      current.active &&
      isResetPath(currentPath.current) &&
      (Platform.OS !== "web" || isResetPath(window.location.pathname)),
    [],
  );
  useLayoutEffect(() => {
    currentPath.current = pathname;
    if (!isResetPath(pathname) || !configured) {
      cancel();
      setState({ kind: "idle" });
    }
  }, [pathname, configured, cancel]);
  useEffect(() => () => cancel(), [cancel]);

  useEffect(() => {
    if (!configured || !isResetPath(pathname)) return;
    const inputHash = Platform.OS === "web" ? window.location.hash : "";
    if (Platform.OS === "web" && inputHash) {
      // Updating only browser history lets Router restore its original fragment. Updating
      // location.hash dispatches popstate and replaces the root, so update both states directly.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      router.setParams({ "#": "" });
    }
    let current = operation.current;
    if (!current || (inputHash && inputHash !== current.inputHash)) {
      cancel();
      let tokens: Operation["tokens"];
      if (Platform.OS === "web") {
        const values = new URLSearchParams(inputHash.slice(1));
        const access_token = values.get("access_token");
        const refresh_token = values.get("refresh_token");
        if (!access_token || !refresh_token) {
          setState({ kind: "invalid" });
          return;
        }
        tokens = { access_token, refresh_token };
      }
      current = {
        id: ++nextOperation.current,
        active: true,
        inputHash,
        tokens,
        started: false,
        owner: null,
        busy: false,
        intentIsCurrent: authCommands.captureIntent(),
      };
      operation.current = current;
      setState({ kind: "preparing" });
    }
    if (!initialized || current.started) return;
    if (!current.intentIsCurrent()) {
      current.tokens = undefined;
      current.active = false;
      setState({ kind: "superseded" });
      return;
    }
    current.started = true;
    const pending = current;
    void preparePasswordRecovery(pending.tokens, () => isActive(pending))
      .then((result) => {
        pending.tokens = undefined;
        if (!isActive(pending)) return;
        if (result.status === "superseded") {
          setState({ kind: "superseded" });
        } else if (result.value && result.owner.isCurrent()) {
          pending.owner = result.owner;
          setState({ kind: "ready", error: null });
        } else {
          setState({ kind: "invalid" });
        }
      })
      .catch((error: unknown) => {
        pending.tokens = undefined;
        if (isActive(pending)) setState({ kind: "failed", error });
      });
  }, [pathname, params, configured, initialized, router, cancel, isActive, attachments]);

  useEffect(
    () =>
      useAuthStore.subscribe(() => {
        const current = operation.current;
        if (current?.owner && !current.owner.isCurrent() && isActive(current)) setState({ kind: "superseded" });
      }),
    [isActive],
  );
  const submit = useCallback(
    async (password: string) => {
      const current = expectedOperation;
      const owner = current?.owner;
      if (!current || !owner || current.busy || !isActive(current) || !owner.isCurrent()) return;
      current.busy = true;
      setState({ kind: "saving" });
      try {
        const result = await useAuthStore.getState().updatePassword(password, owner);
        if (!isActive(current) || result.status === "superseded" || !owner.isCurrent()) return;
        setState({ kind: "signing-out" });
        const signout = await finishPasswordRecovery(owner);
        if (isActive(current) && signout.status === "completed" && owner.isCurrent()) {
          setState({ kind: "finished" });
          router.replace("/auth/login");
        }
      } catch (error: unknown) {
        if (isActive(current) && owner.isCurrent()) setState({ kind: "ready", error });
      } finally {
        current.busy = false;
      }
    },
    [isActive, router, expectedOperation],
  );
  const formKey = state.kind === "idle" || state.kind === "superseded" ? 0 : (expectedOperation?.id ?? 0);
  return <Context.Provider value={{ state, formKey, submit, attach, leave }}>{children}</Context.Provider>;
}
export function usePasswordRecovery() {
  const value = useContext(Context);
  if (!value) throw new Error("Password recovery provider is missing");
  return value;
}
