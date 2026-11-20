"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, Lock, CheckCircle2 } from "lucide-react";

import { updatePasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const initialState = {
  success: false,
  message: "",
};

export default function ResetPasswordPage() {
  const [state, formAction, isPending] = useActionState(
    updatePasswordAction,
    initialState
  );

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  return (
    <Card className="border-cb-border bg-cb-card shadow-xl">
      <CardHeader className="space-y-2">
        <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-cb-border bg-cb-bg">
          <Lock className="h-5 w-5 text-cb-primary" aria-hidden="true" />
        </div>

        <CardTitle className="text-2xl">
          Create a new password
        </CardTitle>

        <CardDescription>
          Choose a strong password for your Codebase Chat account.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-5">
          {/* New password */}
          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-cb-text-primary"
            >
              New password
            </label>

            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your new password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                disabled={isPending}
                className="pr-12"
              />

              <button
                type="button"
                onClick={() => setShowPassword((previous) => !previous)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-text-secondary transition-colors hover:text-cb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>

            <p className="text-xs text-cb-text-secondary">
              Use between 8 and 72 characters.
            </p>
          </div>

          {/* Confirm password */}
          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-cb-text-primary"
            >
              Confirm new password
            </label>

            <div className="relative">
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Enter your new password again"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                disabled={isPending}
                className="pr-12"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword((previous) => !previous)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-text-secondary transition-colors hover:text-cb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary"
                aria-label={
                  showConfirmPassword
                    ? "Hide confirmation password"
                    : "Show confirmation password"
                }
                aria-pressed={showConfirmPassword}
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          {/* Server response */}
          {state.message && (
            <div
              role="alert"
              className="rounded-md border border-cb-error/30 bg-cb-error/10 p-3 text-sm text-cb-error"
            >
              {state.message}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isPending}
          >
            {isPending ? "Updating password..." : "Update password"}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-cb-text-secondary">
          <CheckCircle2
            className="h-4 w-4 text-cb-success"
            aria-hidden="true"
          />
          Your password is securely updated through Supabase.
        </div>

        <div className="mt-5 text-center">
          <Link
            href="/login"
            className="text-sm font-medium text-cb-primary hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
