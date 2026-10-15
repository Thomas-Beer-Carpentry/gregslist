import "react-native-url-polyfill/auto";
import { createClient, processLock } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import { createSecureStorage } from "./secure-storage";
import { isPublishableKey, publicHttpsUrl } from "./security";

const supabaseUrl = publicHttpsUrl(process.env.EXPO_PUBLIC_SUPABASE_URL);
export const siteUrl = publicHttpsUrl(process.env.EXPO_PUBLIC_SITE_URL) || "";
const publicKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const configured = Boolean(
  supabaseUrl && siteUrl && isPublishableKey(publicKey),
);
const nativeStorage = createSecureStorage(
  {
    getItemAsync: (key) => SecureStore.getItemAsync(key),
    setItemAsync: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
  },
  randomUUID,
);

export const db = createClient(
  supabaseUrl || "https://not-configured.invalid",
  publicKey || "not-configured",
  {
    auth: {
      storage: nativeStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  },
);
export const requestId = randomUUID;

export async function apiFetch(path: string, init: RequestInit = {}) {
  if (
    !/^\/(api\/(posts\/[a-f0-9-]+\/photos|mobile\/invitations)|photos\/[a-f0-9-]+)$/.test(
      path,
    )
  )
    throw new Error("Unsupported application request");
  const { data } = await db.auth.getSession();
  if (!data.session) throw new Error("Sign in again to continue.");
  return fetch(`${siteUrl}${path}`, {
    ...init,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      ...init.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
  });
}
