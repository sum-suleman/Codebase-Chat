import * as React from "react";
import { redirect } from "next/navigation";
import { TerminalSquare } from "lucide-react";

import { getCachedUser } from "@/lib/supabase/server";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCachedUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-cb-bg px-4 py-12 text-cb-text-primary">
      {/* Subtle background decoration */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        aria-hidden="true"
      >
        <div className="absolute left-1/2 top-0 h-96 w-96 -translate-x-1/2 rounded-full bg-cb-primary/10 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-cb-border bg-cb-card">
            <TerminalSquare
              className="h-6 w-6 text-cb-primary"
              aria-hidden="true"
            />
          </div>

          <span className="font-mono text-xl font-bold tracking-tight">
            Codebase Chat
          </span>

          <p className="mt-2 text-center text-sm text-cb-text-secondary">
            Understand your codebase. Just ask.
          </p>
        </div>

        {children}

        <p className="mt-8 text-center text-xs text-cb-text-secondary">
          Built for developers, by developers.
        </p>
      </div>
    </main>
  );
}