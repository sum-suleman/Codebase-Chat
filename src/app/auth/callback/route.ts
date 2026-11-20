import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function getSafeSiteUrl(): URL {
  const value = process.env.SITE_URL;

  if (!value) {
    throw new Error("SITE_URL is not configured.");
  }

  const url = new URL(value);

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("SITE_URL is invalid.");
  }

  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:"
  ) {
    throw new Error("Production SITE_URL must use HTTPS.");
  }

  return url;
}

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  try {
    const siteUrl = getSafeSiteUrl();
    const candidate = new URL(value, siteUrl);

    if (candidate.origin !== siteUrl.origin) {
      return "/";
    }

    return `${candidate.pathname}${candidate.search}${candidate.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  let siteUrl: URL;

  try {
    siteUrl = getSafeSiteUrl();
  } catch {
    return NextResponse.json(
      { error: "Authentication configuration is unavailable." },
      { status: 500 }
    );
  }

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = getSafeNextPath(requestUrl.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(
      new URL("/login?error=verification", siteUrl)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/login?error=verification", siteUrl)
    );
  }

  return NextResponse.redirect(new URL(next, siteUrl));
}