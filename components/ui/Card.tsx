import { Text as RNText, View, type TextProps, type ViewProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

const cardVariants = cva("rounded-4xl overflow-hidden", {
  variants: {
    elevation: {
      surface: "bg-surface dark:bg-surface-dark",
      low: "bg-surface-low dark:bg-surface-dark-low",
      mid: "bg-surface-mid dark:bg-surface-dark-mid",
      high: "bg-surface-high dark:bg-surface-dark-high",
      bright: "bg-surface-bright dark:bg-surface-dark-bright",
    },
  },
  defaultVariants: {
    elevation: "low",
  },
});

type CardProps = ViewProps & VariantProps<typeof cardVariants>;

export const Card = forwardRef<View, CardProps>(
  ({ elevation, className, ...props }, ref) => (
    <View
      ref={ref}
      className={cn(cardVariants({ elevation }), className)}
      {...props}
    />
  )
);

Card.displayName = "Card";

export const CardHeader = forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-6 pt-6 pb-3", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

export const CardContent = forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-6 pb-6", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

export const CardFooter = forwardRef<View, ViewProps>(
  ({ className, ...props }, ref) => (
    <View ref={ref} className={cn("px-6 pb-6 pt-0", className)} {...props} />
  )
);
CardFooter.displayName = "CardFooter";

export const CardTitle = forwardRef<RNText, TextProps>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn("font-manrope-semibold text-lg text-charcoal dark:text-neutral-100", className)}
      {...props}
    />
  )
);
CardTitle.displayName = "CardTitle";

export const CardDescription = forwardRef<RNText, TextProps>(
  ({ className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn("font-manrope text-sm leading-relaxed text-warm-500 dark:text-neutral-400", className)}
      {...props}
    />
  )
);
CardDescription.displayName = "CardDescription";

export { cardVariants };
