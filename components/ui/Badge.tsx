import { View, Text, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

const badgeVariants = cva(
  "flex-row items-center justify-center rounded-full px-3 py-1",
  {
    variants: {
      variant: {
        default: "bg-primary-accent/10",
        secondary: "bg-gold/30",
        muted: "bg-surface-high dark:bg-surface-dark-high",
        outline: "bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const badgeTextVariants = cva("font-manrope-medium text-xs", {
  variants: {
    variant: {
      default: "text-primary-accent dark:text-primary-bright",
      secondary: "text-gold-dark",
      muted: "text-charcoal dark:text-neutral-400",
      outline: "text-charcoal dark:text-neutral-300",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type BadgeProps = ViewProps &
  VariantProps<typeof badgeVariants> & {
    label: string;
  };

export const Badge = forwardRef<View, BadgeProps>(
  ({ variant, label, className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      <Text className={cn(badgeTextVariants({ variant }))}>{label}</Text>
    </View>
  )
);

Badge.displayName = "Badge";
export { badgeVariants };
