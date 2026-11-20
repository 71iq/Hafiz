import { useEffect, useState } from "react";
import { CommentsSheet } from "@/components/reflections/CommentsSheet";
import { WriteReflectionSheet } from "@/components/reflections/WriteReflectionSheet";
import { useAuthStore } from "@/lib/auth/store";
import {
  consumeAuthReopen,
  peekAuthReopen,
  subscribeAuthReopen,
  type AuthReopenRequest,
} from "@/lib/auth/return-origin";

type EditorTarget = Omit<Extract<AuthReopenRequest, { kind: "reflection-editor" }>, "kind">;

/**
 * W13: after a guest signs in from the reflection editor or comments, the return target brings them
 * back here and the surface reopens once for the same reference. It opens empty: guest text is never
 * carried over and no action (post, comment, like) is replayed. An account change closes it.
 */
export function AuthReopenSurfaces({ surface }: { surface: "mushaf" | "feed" }) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  // Each reopened surface remembers the account it was opened for; a different account never sees it.
  const [editor, setEditor] = useState<(EditorTarget & { owner: string }) | null>(null);
  const [comments, setComments] = useState<{ reflectionId: string; owner: string } | null>(null);

  useEffect(() => {
    if (!userId) return;
    const take = () => {
      if (surface === "mushaf") {
        const request = consumeAuthReopen("reflection-editor");
        if (request) {
          setEditor({ surah: request.surah, ayahStart: request.ayahStart, ayahEnd: request.ayahEnd, owner: userId });
        }
      }
      // Only the surface the sign-in returned to takes the comments request.
      const pendingComments = peekAuthReopen();
      if (pendingComments?.kind === "comments" && pendingComments.surface === surface) {
        const request = consumeAuthReopen("comments");
        if (request) setComments({ reflectionId: request.reflectionId, owner: userId });
      }
    };
    // A new account or session starts with nothing reopened; only a fresh request opens a surface.
    setEditor(null);
    setComments(null);
    take();
    return subscribeAuthReopen(take);
  }, [surface, userId]);

  if (!userId) return null;
  const shownEditor = editor?.owner === userId ? editor : null;
  const shownComments = comments?.owner === userId ? comments : null;
  return (
    <>
      {shownEditor ? (
        <WriteReflectionSheet
          open
          onClose={() => setEditor(null)}
          surah={shownEditor.surah}
          ayahStart={shownEditor.ayahStart}
          ayahEnd={shownEditor.ayahEnd}
        />
      ) : null}
      {shownComments ? (
        <CommentsSheet
          reflectionId={shownComments.reflectionId}
          onClose={() => setComments(null)}
        />
      ) : null}
    </>
  );
}
