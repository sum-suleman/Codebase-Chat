"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  changePasswordAction,
  type SecurityActionState,
} from "@/app/actions/security";

const initialState: SecurityActionState = {
  success: true,
  message: "",
};

export function SecurityForm() {
  const [state, formAction, isPending] = useActionState(
    changePasswordAction,
    initialState
  );

  const [showPasswords, setShowPasswords] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success && state.message) {
      formRef.current?.reset();
      setShowPasswords(false);
    }
  }, [state]);

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3 rounded-lg border border-cb-border bg-cb-surface p-4">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cb-success" />

        <div className="space-y-1">
          <p className="text-sm font-medium text-cb-text-primary">
            Protect your account
          </p>

          <p className="text-xs leading-relaxed text-cb-text-secondary">
            Choose a strong, unique password. Your current password
            will be verified before any changes are made.
          </p>
        </div>
      </div>

      <form
        ref={formRef}
        action={formAction}
        className="space-y-5"
      >
        <div className="space-y-2">
          <label
            htmlFor="currentPassword"
            className="text-sm font-medium text-cb-text-primary"
          >
            Current Password
          </label>

          <div className="relative">
            <Input
              id="currentPassword"
              name="currentPassword"
              type={showPasswords ? "text" : "password"}
              placeholder="Enter your current password"
              autoComplete="current-password"
              required
              maxLength={72}
              className="pr-11"
            />

            <button
              type="button"
              onClick={() => setShowPasswords((previous) => !previous)}
              className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-cb-text-secondary transition-colors hover:text-cb-text-primary"
              aria-label={
                showPasswords ? "Hide passwords" : "Show passwords"
              }
              aria-pressed={showPasswords}
            >
              {showPasswords ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="newPassword"
            className="text-sm font-medium text-cb-text-primary"
          >
            New Password
          </label>

          <Input
            id="newPassword"
            name="newPassword"
            type={showPasswords ? "text" : "password"}
            placeholder="Enter your new password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
          />

          <p className="text-xs text-cb-text-secondary">
            Use between 8 and 72 characters. Choose a password
            you do not use on other websites.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="confirmPassword"
            className="text-sm font-medium text-cb-text-primary"
          >
            Confirm New Password
          </label>

          <Input
            id="confirmPassword"
            name="confirmPassword"
            type={showPasswords ? "text" : "password"}
            placeholder="Enter your new password again"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
          />
        </div>

        {state.message && (
          <div
            role={state.success ? "status" : "alert"}
            aria-live="polite"
            className={`rounded-md border p-3 text-sm ${
              state.success
                ? "border-cb-success/30 bg-cb-success/10 text-cb-success"
                : "border-cb-error/30 bg-cb-error/10 text-cb-error"
            }`}
          >
            {state.message}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-cb-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-cb-text-secondary">
            You will remain signed in after changing your password.
          </p>

          <Button
            type="submit"
            isLoading={isPending}
            disabled={isPending}
          >
            <LockKeyhole className="mr-2 h-4 w-4" />
            Change Password
          </Button>
        </div>
      </form>
    </div>
  );
}
