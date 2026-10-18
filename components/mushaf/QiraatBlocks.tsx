import { View, Text } from "react-native";
import type { QiraatBlock } from "@/lib/qiraat/parse";

type Props = { blocks: readonly QiraatBlock[] };

export function QiraatBlocks({ blocks }: Props) {
  return (
    <>
      {blocks.map((block, i) => (
        <View key={i} className="mb-4">
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
