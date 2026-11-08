import React from "react";
import { cleanup, render } from "@testing-library/react-native";
import { QiraatBlocks } from "@/components/mushaf/QiraatBlocks";
import type { QiraatBlock } from "@/lib/qiraat/parse";
import { flattenStyle } from "../rtl/rtl-test-utils";

afterEach(cleanup);

it("renders every supplied block literally in order without reparsing or adding a wrapper", () => {
  const blocks: readonly QiraatBlock[] = Object.freeze([
    Object.freeze({ heading: "عنوان تجريبي", body: "سطر أول\n ٢ - قرئ: نص حرفي" }),
    Object.freeze({ heading: null, body: "متن بلا عنوان" }),
    Object.freeze({ heading: "", body: "" }),
  ]);
  const before = JSON.stringify(blocks);
  const view = render(<QiraatBlocks blocks={blocks} />);
  const tree = view.toJSON();
  if (!Array.isArray(tree)) throw new Error("Expected sibling rows without a native wrapper");
  expect(tree.map((row) => row.type)).toEqual(["View", "View", "View"]);
  expect(tree.map((row) => row.props.className)).toEqual(["mb-4", "mb-4", "mb-4"]);
  expect(tree.map((row) => row.children?.length)).toEqual([2, 1, 1]);
  const heading = view.getByText("عنوان تجريبي");
  expect(flattenStyle(heading.props.style)).toEqual({ writingDirection: "rtl", textAlign: "right", fontWeight: "700" });
  const body = view.getByText(blocks[0].body, { normalizer: (value) => value });
  expect(body.props.children).toBe(blocks[0].body);
  expect(flattenStyle(body.props.style)).toEqual({ writingDirection: "rtl", textAlign: "right" });
  expect(view.getByText("متن بلا عنوان").props.children).toBe(blocks[1].body);
  expect(JSON.stringify(blocks)).toBe(before);
});

it("returns no native content for no supplied blocks", () => {
  const view = render(<QiraatBlocks blocks={[]} />);
  expect(view.toJSON()).toBeNull();
});
