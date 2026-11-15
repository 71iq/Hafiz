import { StyleSheet, View, Text } from "react-native";
import type { QiraatBlock } from "@/lib/qiraat/parse";

type Props = { blocks: readonly QiraatBlock[] };

/** Each reading stands apart: 12px of space and a hairline between blocks, none after the last. */
export function QiraatBlocks({ blocks }: Props) {
  return (
    <>
      {blocks.map((block, i) => (
        <View
          key={i}
          className={i < blocks.length - 1 ? "mb-3 pb-3 border-b border-warm-200 dark:border-neutral-800" : "mb-1"}
          style={i < blocks.length - 1 ? { borderBottomWidth: StyleSheet.hairlineWidth } : undefined}
        >
          {block.heading && (
            <Text
              className="text-lg text-primary-accent dark:text-primary-bright mb-1.5"
              style={{ writingDirection: "rtl", textAlign: "right", fontWeight: "700" }}
            >
              {block.heading}
            </Text>
          )}
          <Text
            className="text-base text-charcoal dark:text-neutral-200 leading-8"
            style={{ writingDirection: "rtl", textAlign: "right" }}
          >
            {block.body}
          </Text>
        </View>
      ))}
    </>
  );
}
