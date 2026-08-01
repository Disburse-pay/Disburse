import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.js";

let adminClient: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  const url = readSupabaseServerUrl(process.env);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new HttpError(503, "Supabase server environment variables are not configured.");
  }

  adminClient ??= createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return adminClient;
}

/**
 * Resolve the server project URL without ever accepting a browser key as an
 * admin credential. Supabase project URLs are public identifiers, so a
 * deployment that already exposes VITE_SUPABASE_URL may reuse that URL while
 * the service-role key remains exclusively server-side.
 */
export function readSupabaseServerUrl(environment: Record<string, string | undefined>): string {
  const rawUrl = environment.SUPABASE_URL?.trim() || environment.VITE_SUPABASE_URL?.trim();
  if (!rawUrl) {
    throw new HttpError(503, "Supabase server environment variables are not configured.");
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(503, "Supabase server environment variables are invalid.");
  }

  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new HttpError(503, "Supabase server environment variables are invalid.");
  }
  return url.toString().replace(/\/$/, "");
}
