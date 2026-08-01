import { describe, expect, it } from "vitest";
import { readSupabaseServerUrl } from "./supabase";

describe("Supabase server configuration", () => {
  it("prefers the explicit server URL", () => {
    expect(
      readSupabaseServerUrl({
        SUPABASE_URL: "https://server.supabase.co",
        VITE_SUPABASE_URL: "https://public.supabase.co"
      })
    ).toBe("https://server.supabase.co");
  });

  it("may reuse the public project URL without using a browser credential", () => {
    expect(
      readSupabaseServerUrl({
        VITE_SUPABASE_URL: "https://project.supabase.co/",
        VITE_SUPABASE_ANON_KEY: "not-used-by-the-server"
      })
    ).toBe("https://project.supabase.co");
  });

  it.each([
    "http://project.supabase.co",
    "ftp://project.supabase.co",
    "https://user:password@project.supabase.co",
    "https://project.supabase.co?key=secret"
  ])("rejects an unsafe project URL %s", (url) => {
    expect(() => readSupabaseServerUrl({ SUPABASE_URL: url })).toThrow("invalid");
  });

  it("allows local Supabase over HTTP", () => {
    expect(readSupabaseServerUrl({ SUPABASE_URL: "http://127.0.0.1:54321" })).toBe("http://127.0.0.1:54321");
  });
});
