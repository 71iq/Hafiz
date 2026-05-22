import { Slot } from "@rn-primitives/slot";
import { Pressable, Text, type PressableProps, type PressableStateCallbackType, type ViewStyle } from "react-native";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { forwardRef } from "react";
import { useUIDirection, type Direction } from "@/lib/ui/direction";

const buttonVariants = cva(
  "flex-row items-center justify-center",
  {
    variants: {
      variant: {
        default: "bg-primary-accent",
        secondary: "bg-gold",
        outline: "bg-transparent",
        ghost: "bg-transparent",
        destructive: "bg-red-500",
      },
      size: {
        default: "h-11 px-6 rounded-full",
        sm: "h-9 px-4 rounded-full",
        lg: "h-14 px-8 rounded-full",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const buttonTextVariants = cva("font-manrope-semibold text-center", {
  variants: {
    variant: {
      default: "text-white",
      secondary: "text-gold-dark",
      outline: "text-charcoal dark:text-neutral-200",
      ghost: "text-charcoal dark:text-neutral-200",
      destructive: "text-white",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
      lg: "text-lg",
      icon: "text-base",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    label?: string;
    children?: React.ReactNode;
    dir?: Direction;
  };

export const Button = forwardRef<any, ButtonProps>(
  ({ variant, size, asChild, label, children, className, disabled, style, dir: explicitDir, ...props }, ref) => {
    const Component = asChild ? Slot : Pressable;
    const dir = useUIDirection(explicitDir);

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size }), dir === "rtl" && "flex-row-reverse", className)}
        disabled={disabled}
        style={(state: PressableStateCallbackType) => [
          {
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale: state.pressed ? 0.98 : 1 }],
          } as ViewStyle,
          typeof style === "function" ? style(state) : style,
        ]}
        {...props}
      >
        {children ?? (
          <Text className={cn(buttonTextVariants({ variant, size }))} style={{ writingDirection: dir }}>
            {label}
          </Text>
        )}
      </Component>
    );
  }
);

Button.displayName = "Button";
export { buttonVariants, buttonTextVariants, buttonTextVariants as textVariants };
