import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Input, type InputProps } from "@/components/ui/Input";
import { Field, FieldMessage, Label } from "@/components/ui/Field";
import { type Direction } from "@/lib/ui/direction";

type FormTextFieldProps<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>;
  name: FieldPath<TFieldValues>;
  label: string;
  error?: string;
  dir?: Direction;
  inputProps?: Omit<InputProps, "value" | "onChangeText" | "onBlur" | "dir" | "invalid">;
};

export function FormTextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  error,
  dir,
  inputProps,
}: FormTextFieldProps<TFieldValues>) {
  return (
    <Field dir={dir} className="w-full">
      <Label dir={dir}>{label}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <Input
            dir={dir}
            invalid={!!error}
            onBlur={onBlur}
            onChangeText={onChange}
            value={typeof value === "string" ? value : ""}
            {...inputProps}
          />
        )}
      />
      {error ? <FieldMessage dir={dir}>{error}</FieldMessage> : null}
    </Field>
  );
}
