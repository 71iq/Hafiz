import { Text as RNText, type TextProps } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";

const textVariants = cva("text-charcoal dark:text-neutral-200", {
  variants: {
    variant: {
      // Headlines — Noto Serif
      "display-lg": "font-noto-serif-bold text-4xl leading-tight",
      "display-md": "font-noto-serif-bold text-3xl leading-tight",
      "display-sm": "font-noto-serif-medium text-2xl leading-snug",
      headline: "font-noto-serif-medium text-xl leading-snug",
      // Body — Manrope
      "title-lg": "font-manrope-bold text-lg",
      "title-md": "font-manrope-semibold text-base",
      "title-sm": "font-manrope-semibold text-sm",
      body: "font-manrope text-base leading-relaxed",
      "body-sm": "font-manrope text-sm leading-relaxed",
      // Labels
      "label-lg": "font-manrope-medium text-sm",
      "label-md": "font-manrope-medium text-xs",
      "label-sm": "font-manrope-medium text-[10px] tracking-wider uppercase",
      // Muted
      muted: "font-manrope text-sm text-warm-400 dark:text-neutral-500",
      caption: "font-manrope text-xs text-warm-400 dark:text-neutral-500",
    },
  },
  defaultVariants: {
    variant: "body",
  },
});

type TypographyProps = TextProps & VariantProps<typeof textVariants>;

export const Typography = forwardRef<RNText, TypographyProps>(
  ({ variant, className, ...props }, ref) => (
    <RNText
      ref={ref}
      className={cn(textVariants({ variant }), className)}
      {...props}
    />
  )
);

Typography.displayName = "Typography";
export { textVariants };
