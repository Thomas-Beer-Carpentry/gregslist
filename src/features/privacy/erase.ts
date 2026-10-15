import "server-only";
import { createClient, type User } from "@supabase/supabase-js";
import { adminClient } from "@/lib/supabase/admin";
import { finishAccountErasure } from "@/lib/privacy-worker.mjs";

export async function eraseOwnAccount(user: User, password: string) {
  if (!user.email || !password || password.length > 128)
    return {
      error: "Verify your password before deleting your account.",
      complete: false,
    };
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const proof = await verifier.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (proof.error || proof.data.user?.id !== user.id)
    return {
      error: "Your password could not be verified. No data was deleted.",
      complete: false,
    };
  await verifier.auth.signOut({ scope: "local" });
  const admin = adminClient();
  const prepared = await admin.rpc("prepare_account_erasure", {
    target_user: user.id,
  });
  if (prepared.error)
    return {
      error: prepared.error.message.startsWith("Transfer administrator")
        ? "Give another active member administrator access before deleting the final administrator account."
        : "Deletion could not be started. No erasure was committed; please try again.",
      complete: false,
    };
  try {
    return { error: "", complete: await finishAccountErasure(admin, user.id) };
  } catch {
    return { error: "", complete: false };
  }
}
