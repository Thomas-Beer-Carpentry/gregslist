import type { ExpoConfig } from "expo/config";

const projectId = process.env.EAS_PROJECT_ID;
const browserKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (browserKey && !browserKey.includes("YOUR_")) {
  let safe = /^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(browserKey);
  try {
    safe ||=
      browserKey.split(".").length === 3 &&
      JSON.parse(
        Buffer.from(browserKey.split(".")[1], "base64url").toString("utf8"),
      ).role === "anon";
  } catch {
    /* reject malformed or privileged keys */
  }
  if (!safe)
    throw new Error(
      "The native application accepts only a browser-safe publishable/anon key. Privileged credentials must never be bundled.",
    );
}
if (process.env.EAS_BUILD === "true") {
  const required = [
    "EXPO_PUBLIC_SITE_URL",
    "EXPO_PUBLIC_SUPABASE_URL",
    "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "GREGSLIST_IOS_BUNDLE_ID",
    "GREGSLIST_ANDROID_PACKAGE",
    "EXPO_OWNER",
    "EAS_PROJECT_ID",
  ];
  if (
    required.some(
      (name) => !process.env[name] || process.env[name]!.includes("YOUR_"),
    )
  )
    throw new Error(
      "Publishing requires the real community configuration, owned app identifiers and Expo project. No preview defaults may be published.",
    );
  if (!/^[a-f0-9-]{36}$/i.test(projectId || ""))
    throw new Error(
      "Configure the publisher's real EAS project ID before creating a distributable build.",
    );
  for (const name of ["EXPO_PUBLIC_SITE_URL", "EXPO_PUBLIC_SUPABASE_URL"]) {
    const url = new URL(process.env[name]!);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error("Distributable builds require canonical HTTPS origins.");
  }
  if (
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!.startsWith("sb_secret_")
  )
    throw new Error(
      "Never include a privileged Supabase key in the phone application.",
    );
}

const config: ExpoConfig = {
  name: "Gregslist",
  slug: "gregslist",
  ...(process.env.EXPO_OWNER ? { owner: process.env.EXPO_OWNER } : {}),
  ...(projectId ? { extra: { eas: { projectId } } } : {}),
  version: "0.1.0",
  orientation: "default",
  userInterfaceStyle: "light",
  platforms: ["ios", "android"],
  icon: "./assets/icon.png",
  backgroundColor: "#F6F4EE",
  ios: {
    bundleIdentifier:
      process.env.GREGSLIST_IOS_BUNDLE_ID || "community.gregslist.app",
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription:
        "Choose community post photos to share privately with Gregslist members.",
    },
  },
  android: {
    package: process.env.GREGSLIST_ANDROID_PACKAGE || "community.gregslist.app",
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#0B3D2E",
    },
    permissions: [],
  },
  plugins: [
    "expo-secure-store",
    [
      "expo-image-picker",
      {
        photosPermission: "Choose photos for your private community posts.",
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  experiments: { tsconfigPaths: true },
};
export default config;
