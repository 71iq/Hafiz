import { Text, View } from "react-native";

type Props = {
  title: string;
  message: string;
  variant?: "startup" | "profile";
};

export function DatabaseErrorState({ title, message, variant = "startup" }: Props) {
  const isProfile = variant === "profile";
  return (
    <View
      className={
        isProfile
          ? "flex-1 items-center justify-center bg-surface px-6 dark:bg-surface-dark"
          : "flex-1 items-center justify-center bg-surface dark:bg-surface-dark px-6"
      }
    >
      <Text
        className={isProfile ? "mb-2 text-red-600" : "text-red-600 mb-4"}
        style={{ fontFamily: "Manrope_700Bold", fontSize: 18 }}
      >
        {title}
      </Text>
      <Text
        className={isProfile ? "text-center text-red-500" : "text-red-500 text-center"}
        style={{ fontFamily: "Manrope_400Regular", fontSize: isProfile ? 14 : 15 }}
      >
        {message}
      </Text>
    </View>
  );
}
