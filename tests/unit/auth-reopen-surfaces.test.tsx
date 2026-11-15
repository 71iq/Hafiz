import React from "react";
import { act, render } from "@testing-library/react-native";
import { AuthReopenSurfaces } from "@/components/auth/AuthReopenSurfaces";

let mockUserId: string | null = "user-1";
const mockConsume = jest.fn();
const mockEditor = jest.fn((_props: Record<string, unknown>) => null);
const mockComments = jest.fn((_props: Record<string, unknown>) => null);

jest.mock("@/lib/auth/store", () => ({
  useAuthStore: (select: (state: { user: { id: string } | null }) => unknown) =>
    select({ user: mockUserId ? { id: mockUserId } : null }),
}));
jest.mock("@/lib/auth/return-origin", () => ({
  consumeAuthReopen: (kind: string) => mockConsume(kind),
  subscribeAuthReopen: () => () => {},
}));
jest.mock("@/components/reflections/WriteReflectionSheet", () => ({
  WriteReflectionSheet: (props: Record<string, unknown>) => mockEditor(props),
}));
jest.mock("@/components/reflections/CommentsSheet", () => ({
  CommentsSheet: (props: Record<string, unknown>) => mockComments(props),
}));

beforeEach(() => {
  mockUserId = "user-1";
  mockConsume.mockReset().mockReturnValue(null);
  mockEditor.mockClear();
  mockComments.mockClear();
});

describe("reopening a surface after sign-in (W13)", () => {
  it("reopens the reflection editor once for the safe range, with no guest text", () => {
    mockConsume.mockImplementation((kind: string) =>
      kind === "reflection-editor" ? { kind, surah: 2, ayahStart: 255, ayahEnd: 257 } : null,
    );
    render(<AuthReopenSurfaces surface="mushaf" />);
    expect(mockEditor).toHaveBeenCalled();
    const props = mockEditor.mock.calls.at(-1)?.[0] ?? {};
    expect(props).toMatchObject({ open: true, surah: 2, ayahStart: 255, ayahEnd: 257 });
    expect(props).not.toHaveProperty("initialContent");
  });

  it("does nothing for a guest", () => {
    mockUserId = null;
    mockConsume.mockReturnValue({ kind: "comments", reflectionId: "r" });
    render(<AuthReopenSurfaces surface="feed" />);
    expect(mockConsume).not.toHaveBeenCalled();
    expect(mockComments).not.toHaveBeenCalled();
  });

  it("reopens comments for the reflection only, and an account change closes it", () => {
    mockConsume.mockImplementation((kind: string) =>
      kind === "comments" ? { kind, reflectionId: "11111111-1111-4111-8111-111111111111" } : null,
    );
    const view = render(<AuthReopenSurfaces surface="feed" />);
    expect(mockComments.mock.calls.at(-1)?.[0]).toMatchObject({
      reflectionId: "11111111-1111-4111-8111-111111111111",
    });
    mockComments.mockClear();
    mockConsume.mockReturnValue(null);
    mockUserId = "user-2";
    act(() => view.rerender(<AuthReopenSurfaces surface="feed" />));
    expect(mockComments).not.toHaveBeenCalled();
  });
});
