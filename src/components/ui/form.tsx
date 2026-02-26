import { type Ref } from "react";
import { View, TextInput } from "react-native";
import {
  Controller,
  type Control,
  type FieldValues,
  type Path,
} from "react-hook-form";
import { Input } from "./input";
import { Text } from "./text";
import type { TextInputProps } from "react-native";

interface FormFieldProps<T extends FieldValues> extends Omit<TextInputProps, "value" | "onChangeText"> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  className?: string;
  inputRef?: Ref<TextInput>;
}

export function FormField<T extends FieldValues>({
  control,
  name,
  label,
  className,
  inputRef,
  ...inputProps
}: FormFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value }, fieldState: { error } }) => (
        <View className={className}>
          <Text variant="muted" className="text-sm mb-1 ml-1">{label}</Text>
          <Input
            ref={inputRef}
            value={value}
            onChangeText={onChange}
            onBlur={onBlur}
            error={!!error}
            {...inputProps}
          />
          {error?.message && (
            <Text variant="destructive" className="text-xs mt-1 ml-1">
              {error.message}
            </Text>
          )}
        </View>
      )}
    />
  );
}
