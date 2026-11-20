import * as React from "react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function ResetPasswordLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let isAuthenticated = false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      isAuthenticated = true;
    }
  } catch {
    // Authentication could not be verified.
  }

  if (!isAuthenticated) {
    redirect("/login");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-cb-bg p-4 text-cb-text-primary">
      <div className="w-full max-w-md animate-in fade-in zoom-in-95 duration-500">
        {children}
      </div>
    </main>
  );
}
