import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getAdminConfig(): { url: string; serviceRoleKey: string } {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!rawUrl || !serviceRoleKey) {
    throw new Error(
      "Missing required Supabase admin environment variables."
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is invalid.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
  }

  if (publishableKey && serviceRoleKey === publishableKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY must not match NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return {
    url: rawUrl,
    serviceRoleKey,
  };
}

export function createAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = getAdminConfig();

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
