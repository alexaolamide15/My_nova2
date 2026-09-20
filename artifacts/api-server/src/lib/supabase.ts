import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return client;
}

export async function verifySupabaseConnection(): Promise<void> {
  const { error } = await getSupabaseAdmin().from("bot_config").select("id").limit(1);
  if (error && error.code !== "42P01") throw error;
}

export async function closeDatabase(): Promise<void> {
  client = undefined;
}

export const connectDB = verifySupabaseConnection;
export const disconnectDB = closeDatabase;
