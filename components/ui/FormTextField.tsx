import { type Ref } from "react";
import { TextInput } from "react-native";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Input, type InputProps } from "@/components/ui/Input";
import { Field, FieldMessage } from "@/components/ui/Field";
import { type Direction } from "@/lib/ui/direction";
import { cn } from "@/lib/utils";

/** The app's outline pair (as in Reminder settings), so a label-free field still has a visible edge. */
const FIELD_OUTLINE = "border border-warm-300 dark:border-neutral-700";

type FormTextFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  /** The input's accessible name and, unless inputProps sets one, its placeholder. No visible label renders. */
  label: string;
  error?: string;
  /** Muted guidance under the field, shown until an error replaces it. */
  hint?: string;
  dir?: Direction;
  inputRef?: Ref<TextInput>;
  inputProps?: Omit<InputProps, "value" | "onChangeText" | "onBlur" | "dir" | "invalid">;
};

export function FormTextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  error,
  hint,
  dir,
  inputRef,
  inputProps,
}: FormTextFieldProps<TFieldValues>) {
  const wrapped = Boolean(inputProps?.startIcon || inputProps?.endIcon);
  return (
    <Field dir={dir} className="w-full">
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            ref={inputRef}
            dir={dir}
            invalid={!!error}
            accessibilityLabel={inputProps?.accessibilityLabel ?? label}
            onBlur={onBlur}
            onChangeText={onChange}
            placeholder={inputProps?.placeholder ?? label}
            value={typeof value === "string" ? value : ""}
            {...inputProps}
            // Without a visible label the field's own outline marks it; in the white theme the box matches
            // the card. An invalid field shows Input's red edge instead.
            className={cn(!error && !wrapped && FIELD_OUTLINE, inputProps?.className)}
            containerClassName={cn(!error && wrapped && FIELD_OUTLINE, inputProps?.containerClassName)}
          />
        )}
      />
      {error ? (
        <FieldMessage dir={dir} accessibilityLiveRegion="polite">
          {error}
        </FieldMessage>
      ) : hint ? (
        <FieldMessage dir={dir} tone="muted">
          {hint}
        </FieldMessage>
      ) : null}
    </Field>
  );
}
