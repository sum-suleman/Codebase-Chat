"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  success: boolean;
  message: string;
}

function getFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getFormValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getSafeSiteUrl(): string {
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

  return url.origin;
}

export async function loginAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = getFormString(formData, "email").toLowerCase();
  const password = getFormValue(formData, "password");

  if (!email || !password) {
    return {
      success: false,
      message: "Please enter your email address and password.",
    };
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    password.length > 72
  ) {
    return {
      success: false,
      message: "Please check your login details.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return {
      success: false,
      message: "Invalid email or password. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signupAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const fullName = getFormString(formData, "fullName");
  const email = getFormString(formData, "email").toLowerCase();
  const password = getFormValue(formData, "password");
  const confirmPassword = getFormValue(formData, "confirmPassword");

  if (!fullName || !email || !password || !confirmPassword) {
    return {
      success: false,
      message: "Please complete all fields.",
    };
  }

  if (fullName.length > 80) {
    return {
      success: false,
      message: "Your name must be 80 characters or fewer.",
    };
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return {
      success: false,
      message: "Please enter a valid email address.",
    };
  }

  if (password.length < 8 || password.length > 72) {
    return {
      success: false,
      message: "Your password must be between 8 and 72 characters.",
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      message: "Your passwords do not match.",
    };
  }

  let siteUrl: string;

  try {
    siteUrl = getSafeSiteUrl();
  } catch {
    return {
      success: false,
      message: "Account registration is temporarily unavailable.",
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    const errorCode =
      "code" in error && typeof error.code === "string"
        ? error.code
        : undefined;

    const isDuplicate =
      errorCode === "user_already_exists" ||
      error.message.includes("already registered") ||
      error.message.includes("already been registered");

    if (isDuplicate) {
      return {
        success: true,
        message: "Please check your email for verification instructions.",
      };
    }

    return {
      success: false,
      message: "We couldn't create your account. Please try again.",
    };
  }

  // Supabase may return an empty identities array for an existing
  // account when email enumeration protection is enabled.
  if (data.user?.identities && data.user.identities.length === 0) {
    return {
      success: true,
      message: "Please check your email for verification instructions.",
    };
  }

  return {
    success: true,
    message: "Account created. Please check your email to verify your address.",
  };
}

export async function requestPasswordResetAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = getFormString(formData, "email").toLowerCase();

  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return {
      success: false,
      message: "Please enter a valid email address.",
    };
  }

  let siteUrl: string;

  try {
    siteUrl = getSafeSiteUrl();
  } catch {
    return {
      success: false,
      message: "Password reset is temporarily unavailable.",
    };
  }

  try {
    const supabase = await createClient();
    const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;

    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  } catch {
    // Return a generic response to prevent account enumeration.
  }

  return {
    success: true,
    message: "If an account exists, a reset link has been sent to your email.",
  };
}

export async function updatePasswordAction(
  _previousState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const password = getFormValue(formData, "password");
  const confirmPassword = getFormValue(formData, "confirmPassword");

  if (!password || !confirmPassword) {
    return {
      success: false,
      message: "Please complete all fields.",
    };
  }

  if (password.length < 8 || password.length > 72) {
    return {
      success: false,
      message: "Your password must be between 8 and 72 characters.",
    };
  }

  if (password !== confirmPassword) {
    return {
      success: false,
      message: "Your passwords do not match.",
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;

  try {
    supabase = await createClient();
  } catch {
    return {
      success: false,
      message: "Authentication service is currently unavailable. Please try again later.",
    };
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return {
        success: false,
        message: "Your session is invalid or has expired. Please request a new link.",
      };
    }
  } catch {
    return {
      success: false,
      message: "Unable to verify your session securely. Please request a new link.",
    };
  }

  try {
    const { error: updateError } = await supabase.auth.updateUser({
      password,
    });

    if (updateError) {
      return {
        success: false,
        message: "We couldn't update your password. Please try requesting a new link.",
      };
    }
  } catch {
    return {
      success: false,
      message: "An unexpected error occurred while updating your password.",
    };
  }

  let signOutSuccess = false;

  try {
    const { error: signOutError } = await supabase.auth.signOut({
      scope: "local",
    });

    if (!signOutError) {
      signOutSuccess = true;
    }
  } catch {
    // Password has already changed. The user remains authenticated.
  }

  revalidatePath("/", "layout");

  if (!signOutSuccess) {
    redirect("/");
  }

  redirect("/login?message=password_updated");
}

export async function logoutAction(
  _previousState: AuthState,
  _formData: FormData
): Promise<AuthState> {
  void _previousState;
  void _formData;

  const supabase = await createClient();

  const { error } = await supabase.auth.signOut({
    scope: "local",
  });

  if (error) {
    return {
      success: false,
      message: "We couldn't sign you out. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/login?logged_out=1");
}
