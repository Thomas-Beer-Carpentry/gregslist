import React, { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from "react-native";

export const palette = {
  forest: "#0B3D2E",
  deep: "#145A3A",
  sage: "#2F7D6B",
  sand: "#CBBFA6",
  charcoal: "#1B1F23",
  background: "#F6F4EE",
  border: "#E3E0D7",
  white: "#FFFFFF",
};
export const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
    gap: 10,
  },
  title: {
    color: palette.forest,
    fontWeight: "700",
    fontSize: 24,
    lineHeight: 31,
  },
  body: { color: palette.charcoal, fontSize: 16, lineHeight: 25 },
  muted: { color: palette.deep, fontSize: 14, lineHeight: 22 },
  label: { color: palette.charcoal, fontWeight: "600", fontSize: 16 },
  field: {
    borderColor: palette.sage,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: palette.white,
    minHeight: 48,
    padding: 12,
    color: palette.charcoal,
    fontSize: 16,
  },
  button: {
    backgroundColor: palette.forest,
    minHeight: 48,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.forest,
  },
  secondary: { backgroundColor: palette.white },
  buttonText: {
    color: palette.white,
    fontWeight: "600",
    fontSize: 16,
    textAlign: "center",
  },
  buttonSecondary: { color: palette.forest },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  feedback: {
    backgroundColor: palette.background,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: palette.charcoal,
    fontSize: 16,
    lineHeight: 24,
  },
});
export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}
export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}
export function Body({ children }: { children: ReactNode }) {
  return <Text style={styles.body}>{children}</Text>;
}
export function Muted({ children }: { children: ReactNode }) {
  return <Text style={styles.muted}>{children}</Text>;
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonSecondary]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = "default",
  secureTextEntry = false,
  maxLength,
  autoCapitalize = "sentences",
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  maxLength?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
        maxLength={maxLength}
        autoCapitalize={secureTextEntry ? "none" : autoCapitalize}
        autoCorrect={!secureTextEntry && keyboardType !== "email-address"}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[
          styles.field,
          multiline && { minHeight: 100, textAlignVertical: "top" },
          focus && { borderColor: palette.forest, borderWidth: 2 },
        ]}
      />
    </View>
  );
}
export function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <Button
        secondary
        title={`${options.find((o) => o.value === value)?.label || "Choose"} ${open ? "▴" : "▾"}`}
        onPress={() => setOpen(!open)}
      />
      {open &&
        options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ checked: option.value === value }}
            onPress={() => {
              onChange(option.value);
              setOpen(false);
            }}
            style={[
              styles.field,
              { justifyContent: "center" },
              option.value === value && { borderColor: palette.forest },
            ]}
          >
            <Text style={styles.body}>
              {option.value === value ? "✓ " : ""}
              {option.label}
            </Text>
          </Pressable>
        ))}
    </View>
  );
}
export function Feedback({ message }: { message: string }) {
  return message ? (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.feedback}
    >
      {message}
    </Text>
  ) : null;
}
export function Loading() {
  return (
    <ActivityIndicator
      color={palette.forest}
      accessibilityLabel="Loading"
      style={{ padding: 20 }}
    />
  );
}
