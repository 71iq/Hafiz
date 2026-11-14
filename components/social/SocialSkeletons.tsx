import type { ReactNode } from "react";
import { View } from "react-native";
import { Card } from "@/components/ui/Card";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useSettings } from "@/lib/settings/context";
import { socialRowStyle } from "./SocialControls";

/**
 * Loading placeholders shaped like the rows they stand in for, so the layout does not jump when the
 * data arrives. Each block is one accessible "loading" element.
 */
function LoadingBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} className="gap-2.5">
      {children}
    </View>
  );
}

/** A halaqa while it loads: the goal card, then member rows with avatar, name and week dots. */
export function HalaqaSkeleton({ label }: { label: string }) {
  const { isRTL } = useSettings();
  return (
    <LoadingBlock label={label}>
      <Card elevation="low" className="gap-3 p-5">
        <SkeletonText width="55%" lineHeight={22} />
        <SkeletonText width="30%" lineHeight={12} />
        <Skeleton height={12} borderRadius={6} className="mt-2" />
      </Card>
      {[0, 1, 2].map((index) => (
        <Card key={index} elevation="low" className="gap-3 px-4 py-3.5">
          <View className="items-center gap-3" style={socialRowStyle(isRTL)}>
            <Skeleton width={40} height={40} borderRadius={20} />
            <View className="min-w-0 flex-1" style={{ alignItems: isRTL ? "flex-end" : "flex-start" }}>
              <SkeletonText width={index === 1 ? "45%" : "60%"} lineHeight={14} />
            </View>
          </View>
          <View className="items-center gap-1.5" style={socialRowStyle(isRTL)}>
            {Array.from({ length: 7 }, (_, dot) => (
              <Skeleton key={dot} width={12} height={12} borderRadius={6} />
            ))}
          </View>
        </Card>
      ))}
    </LoadingBlock>
  );
}

/**
 * The Board join form while the account's stored choices load, shaped like BoardJoin: one card with
 * the trophy disc and centered headline, the intention text, two toggle rows and Join.
 */
export function BoardJoinSkeleton({ label }: { label: string }) {
  const { isRTL } = useSettings();
  return (
    <LoadingBlock label={label}>
      <Card elevation="low" className="gap-4 p-6">
        <View className="items-center gap-3">
          <Skeleton width={64} height={64} borderRadius={32} />
          <SkeletonText width="60%" lineHeight={24} />
        </View>
        <View className="gap-2">
          <SkeletonText width="95%" lineHeight={14} />
          <SkeletonText width="90%" lineHeight={14} />
          <SkeletonText width="70%" lineHeight={14} />
        </View>
        {[0, 1].map((index) => (
          <View key={index} className="items-center justify-between gap-3 py-2" style={socialRowStyle(isRTL)}>
            <SkeletonText width={index === 0 ? "55%" : "45%"} lineHeight={14} />
            <Skeleton width={44} height={26} borderRadius={13} />
          </View>
        ))}
        <Skeleton height={44} borderRadius={22} />
      </Card>
    </LoadingBlock>
  );
}

/** Board standings while they load: rank, avatar, name and points, like StandingRow. */
export function StandingsSkeleton({ label }: { label: string }) {
  const { isRTL } = useSettings();
  return (
    <LoadingBlock label={label}>
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          className="items-center gap-3 rounded-3xl bg-surface-low px-4 py-3 dark:bg-surface-dark-low"
          style={socialRowStyle(isRTL)}
        >
          <Skeleton width={36} height={36} borderRadius={18} />
          <Skeleton width={36} height={36} borderRadius={18} />
          <View className="min-w-0 flex-1" style={{ alignItems: isRTL ? "flex-end" : "flex-start" }}>
            <SkeletonText width={index % 2 === 0 ? "60%" : "45%"} lineHeight={14} />
            <SkeletonText width="25%" lineHeight={10} />
          </View>
          <Skeleton width={28} height={28} borderRadius={8} />
        </View>
      ))}
    </LoadingBlock>
  );
}

/** The teacher view while it loads: the plan card's lines and stage rows. */
export function TeacherViewSkeleton({ label }: { label: string }) {
  const { isRTL } = useSettings();
  return (
    <LoadingBlock label={label}>
      <Card elevation="low" className="gap-2 p-4">
        <SkeletonText width="30%" lineHeight={16} />
        <SkeletonText width="70%" lineHeight={12} />
        <SkeletonText width="55%" lineHeight={12} />
        {[0, 1, 2].map((index) => (
          <View key={index} className="min-h-8 items-center justify-between" style={socialRowStyle(isRTL)}>
            <SkeletonText width="40%" lineHeight={12} />
            <SkeletonText width={24} lineHeight={12} />
          </View>
        ))}
      </Card>
    </LoadingBlock>
  );
}
