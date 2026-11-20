"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";

import { loginAction } from "@/app/actions/auth";
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

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(
    loginAction,
    initialState
  );

  const [showPassword, setShowPassword] = useState(false);
  
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    setPasswordUpdated(
      params.get("message") === "password_updated"
    );
  }, []);

  return (
    <Card className="border-cb-border bg-cb-card shadow-xl">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl">
          Welcome back
        </CardTitle>

        <CardDescription>
          Sign in to continue exploring your codebase.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {passwordUpdated && (
          <div
            role="status"
            className="mb-5 rounded-md border border-cb-success/30 bg-cb-success/10 p-3 text-sm text-cb-success"
          >
            Your password has been updated successfully. Please sign in with your new password.
          </div>
        )}

        <form action={formAction} className="space-y-5">
          {/* Email */}
          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-cb-text-primary"
            >
              Email address
            </label>

            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                aria-hidden="true"
              />

              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                maxLength={254}
                className="pl-10"
              />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-sm font-medium text-cb-text-primary"
              >
                Password
              </label>

              <Link
                href="/forgot-password"
                className="text-sm font-medium text-cb-primary hover:underline"
              >
                Forgot password?
              </Link>
            </div>

            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                aria-hidden="true"
              />

              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={72}
                className="pl-10 pr-12"
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
          </div>

          {/* Server response */}
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

          {/* Submit */}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            isLoading={isPending}
          >
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>

        {/* Signup link */}
        <div className="mt-6 border-t border-cb-border pt-5 text-center">
          <p className="text-sm text-cb-text-secondary">
            Don't have an account?{" "}
            <Link
              href="/signup"
              className="font-medium text-cb-primary hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
