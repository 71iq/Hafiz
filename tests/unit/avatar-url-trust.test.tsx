import React from "react";
import { Image } from "react-native";
import { render } from "@testing-library/react-native";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { trustedAvatarUrl } from "@/lib/profile/avatar";

const BUCKET = "https://api.synthetic.example/storage/v1/object/public/avatars/";
const OWNER = "3f2b8c1e-5d4a-4b6f-9a70-1c2d3e4f5a6b";
const STORED = `${BUCKET}${OWNER}/1763000000000.webp`;

jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: {
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://api.synthetic.example/storage/v1/object/public/${bucket}/${path}` },
        }),
      }),
    },
  },
}));

describe("profile photos load only from the app's avatars bucket", () => {
  it("accepts a photo the app stored for an account", () => {
    expect(trustedAvatarUrl(STORED)).toBe(STORED);
    expect(trustedAvatarUrl(`${BUCKET}${OWNER.toUpperCase()}/1.JPG`)).toBe(`${BUCKET}${OWNER.toUpperCase()}/1.JPG`);
  });

  it.each([
    ["another server", `https://tracker.example/pixel.png`],
    [
      "another server that repeats the bucket path",
      `https://tracker.example/storage/v1/object/public/avatars/${OWNER}/1.png`,
    ],
    [
      "a host that only starts like the API host",
      STORED.replace("api.synthetic.example", "api.synthetic.example.evil.test"),
    ],
    ["an unencrypted address", STORED.replace("https://", "http://")],
    ["another bucket", STORED.replace("/avatars/", "/private/")],
    ["a path outside an account folder", `${BUCKET}1763000000000.webp`],
    ["a path that climbs out of the bucket", `${BUCKET}${OWNER}/../../../../auth/v1/logout`],
    ["a nested path", `${BUCKET}${OWNER}/more/1.png`],
    ["a query string", `${STORED}?redirect=https://tracker.example`],
    ["a fragment", `${STORED}#x`],
    ["a file that is not an allowed image type", `${BUCKET}${OWNER}/1.svg`],
    ["a data address", "data:image/png;base64,AAAA"],
    ["a local file address", "file:///data/user/0/com.anonymous.hafiz/files/secret.png"],
    ["a script address", "javascript:alert(1)"],
    ["an empty value", ""],
    ["no value", null],
  ])("rejects %s", (_name, url) => {
    expect(trustedAvatarUrl(url)).toBeNull();
  });

  it("shows the initial instead of requesting an address outside the bucket", () => {
    const view = render(<ProfileAvatar avatarUrl="https://tracker.example/pixel.png" name="Synthetic Reader" />);

    expect(view.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    // The initial is decorative, so it is hidden from assistive technology.
    expect(view.getByText("S", { includeHiddenElements: true })).toBeTruthy();
  });

  it("shows a stored photo, and a photo just picked on this device before it is uploaded", () => {
    const stored = render(<ProfileAvatar avatarUrl={STORED} name="Synthetic Reader" />);
    expect(stored.UNSAFE_getByType(Image).props.source).toEqual({ uri: STORED });

    const picked = render(
      <ProfileAvatar avatarUrl={STORED} localPreviewUri="blob:synthetic-pick" name="Synthetic Reader" />,
    );
    expect(picked.UNSAFE_getByType(Image).props.source).toEqual({ uri: "blob:synthetic-pick" });
  });
});
