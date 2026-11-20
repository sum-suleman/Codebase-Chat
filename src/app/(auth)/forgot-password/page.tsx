"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowLeft, Mail } from "lucide-react";

import { requestPasswordResetAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialState = {
  success: false,
  message: "",
};

export default function ForgotPasswordPage() {
  const [state, formAction, isPending] = useActionState(
    requestPasswordResetAction,
    initialState
  );

  return (
    <Card className="border-cb-border bg-cb-card shadow-xl">
      <CardHeader className="space-y-2">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-cb-border bg-cb-bg">
          <Mail className="h-5 w-5 text-cb-primary" aria-hidden="true" />
        </div>

        <CardTitle className="text-2xl">
          Forgot your password?
        </CardTitle>

        <CardDescription>
          Enter the email address associated with your account. We&apos;ll send
          you a link to reset your password.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-cb-text-primary"
            >
              Email address
            </label>

            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              maxLength={254}
              disabled={isPending || state.success}
            />
          </div>

          {state.message && (
            <div
              role={state.success ? "status" : "alert"}
              className={
                state.success
                  ? "rounded-md border border-cb-success/30 bg-cb-success/10 p-3 text-sm text-cb-success"
                  : "rounded-md border border-cb-error/30 bg-cb-error/10 p-3 text-sm text-cb-error"
              }
            >
              {state.message}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isPending}
            disabled={isPending || state.success}
          >
            {isPending ? "Sending reset link..." : "Send reset link"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center border-t border-cb-border pt-5">
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-sm font-medium text-cb-text-secondary transition-colors hover:text-cb-primary"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
