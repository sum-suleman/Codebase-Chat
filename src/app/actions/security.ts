"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export type SecurityActionState = {
  success: boolean;
  message: string;
};

function getPasswordValue(formData: FormData, key: string): string {
  const value = formData.get(key);

  return typeof value === "string" ? value : "";
}

export async function changePasswordAction(
  _previousState: SecurityActionState,
  formData: FormData
): Promise<SecurityActionState> {
  const currentPassword = getPasswordValue(
    formData,
    "currentPassword"
  );

  const newPassword = getPasswordValue(
    formData,
    "newPassword"
  );

  const confirmPassword = getPasswordValue(
    formData,
    "confirmPassword"
  );

  // Validate required fields.
  if (!currentPassword || !newPassword || !confirmPassword) {
    return {
      success: false,
      message: "Please complete all password fields.",
    };
  }

  // Validate password lengths.
  if (
    currentPassword.length > 72 ||
    newPassword.length < 8 ||
    newPassword.length > 72
  ) {
    return {
      success: false,
      message: "Your new password must be between 8 and 72 characters.",
    };
  }

  // Prevent accidental password reuse.
  if (currentPassword === newPassword) {
    return {
      success: false,
      message: "Your new password must be different from your current password.",
    };
  }

  // Confirm the new password.
  if (newPassword !== confirmPassword) {
    return {
      success: false,
      message: "Your new passwords do not match.",
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;

  try {
    supabase = await createClient();
  } catch {
    return {
      success: false,
      message: "Authentication service is temporarily unavailable.",
    };
  }

  // Retrieve the authenticated user.
  let user;

  try {
    const {
      data: { user: authenticatedUser },
      error,
    } = await supabase.auth.getUser();

    if (error || !authenticatedUser) {
      return {
        success: false,
        message: "Your session has expired. Please sign in again.",
      };
    }

    user = authenticatedUser;
  } catch {
    return {
      success: false,
      message: "Unable to verify your session. Please sign in again.",
    };
  }

  if (!user.email) {
    return {
      success: false,
      message: "Your account does not have an email address for password verification.",
    };
  }

  // Verify the current password using a separate stateless client.
try {
  const verificationClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  );

  const { error: verificationError } =
    await verificationClient.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

  if (verificationError) {
    return {
      success: false,
      message: "Your current password is incorrect.",
    };
  }
} catch {
  return {
    success: false,
    message: "Unable to verify your current password. Please try again.",
  };
}

  // Update the authenticated user's password.
  try {
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      return {
        success: false,
        message: "We couldn't update your password. Please try again.",
      };
    }
  } catch {
    return {
      success: false,
      message: "An unexpected error occurred while updating your password.",
    };
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");

  return {
    success: true,
    message: "Your password has been changed successfully.",
  };
}
