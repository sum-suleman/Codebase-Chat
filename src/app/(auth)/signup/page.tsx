"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, User, Mail, Lock } from "lucide-react";

import { signupAction } from "@/app/actions/auth";
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

export default function SignupPage() {
  const [state, formAction, isPending] = useActionState(
    signupAction,
    initialState
  );

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  return (
    <Card className="border-cb-border bg-cb-card shadow-xl">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl">
          Create your account
        </CardTitle>

        <CardDescription>
          Start understanding your codebase with AI-powered insights.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form action={formAction} className="space-y-4">
          {/* Full name */}
          <div className="space-y-2">
            <label
              htmlFor="fullName"
              className="text-sm font-medium text-cb-text-primary"
            >
              Full name
            </label>

            <div className="relative">
              <User
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                aria-hidden="true"
              />

              <Input
                id="fullName"
                name="fullName"
                type="text"
                placeholder="Your name"
                autoComplete="name"
                required
                maxLength={80}
                className="pl-10"
              />
            </div>
          </div>

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
            <label
              htmlFor="password"
              className="text-sm font-medium text-cb-text-primary"
            >
              Password
            </label>

            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                aria-hidden="true"
              />

              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="At least 8 characters"
                autoComplete="new-password"
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

          {/* Confirm password */}
          <div className="space-y-2">
            <label
              htmlFor="confirmPassword"
              className="text-sm font-medium text-cb-text-primary"
            >
              Confirm password
            </label>

            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cb-text-secondary"
                aria-hidden="true"
              />

              <Input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                className="pl-10 pr-12"
              />

              <button
                type="button"
                onClick={() =>
                  setShowConfirmPassword((previous) => !previous)
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-cb-text-secondary transition-colors hover:text-cb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cb-primary"
                aria-label={
                  showConfirmPassword
                    ? "Hide password confirmation"
                    : "Show password confirmation"
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
            {isPending ? "Creating account..." : "Create account"}
          </Button>
        </form>

        {/* Login link */}
        <div className="mt-6 border-t border-cb-border pt-5 text-center">
          <p className="text-sm text-cb-text-secondary">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-medium text-cb-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}