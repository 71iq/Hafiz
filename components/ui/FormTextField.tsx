import { type Ref } from "react";
import { TextInput } from "react-native";
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Input, type InputProps } from "@/components/ui/Input";
import { Field, FieldMessage } from "@/components/ui/Field";
import { type Direction } from "@/lib/ui/direction";

type FormTextFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  error?: string;
  dir?: Direction;
  inputRef?: Ref<TextInput>;
  inputProps?: Omit<InputProps, "value" | "onChangeText" | "onBlur" | "dir" | "invalid">;
};

export function FormTextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  error,
  dir,
  inputRef,
  inputProps,
}: FormTextFieldProps<TFieldValues>) {
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
          />
        )}
      />
      {error ? <FieldMessage dir={dir}>{error}</FieldMessage> : null}
    </Field>
  );
}
