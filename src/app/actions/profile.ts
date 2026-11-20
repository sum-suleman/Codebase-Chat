"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ProfileActionState = {
  success: boolean;
  message: string;
};

export async function updateProfileAction(
  _previousState: ProfileActionState,
  formData: FormData
): Promise<ProfileActionState> {
  const displayName = formData.get("display_name");

  if (typeof displayName !== "string") {
    return {
      success: false,
      message: "Please enter a valid display name.",
    };
  }

  const trimmedName = displayName.trim();

  if (!trimmedName) {
    return {
      success: false,
      message: "Display name cannot be empty.",
    };
  }

  if (trimmedName.length > 80) {
    return {
      success: false,
      message: "Display name cannot exceed 80 characters.",
    };
  }

  if (/[\u0000-\u001F\u007F]/.test(trimmedName)) {
    return {
      success: false,
      message: "Display name contains invalid characters.",
    };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      message: "Your session has expired. Please sign in again.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: trimmedName,
    })
    .eq("id", user.id);

  if (error) {
    console.error("Profile update failed:", error.message);

    return {
      success: false,
      message: "Unable to update your profile. Please try again.",
    };
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");

  return {
    success: true,
    message: "Your profile has been updated successfully.",
  };
}

export async function updateAvatarUrlAction(
  avatarUrl: string | null
): Promise<ProfileActionState> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      message: "Your session has expired. Please sign in again.",
    };
  }

  if (avatarUrl !== null) {
    try {
      const imageUrl = new URL(avatarUrl);
      const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);

      const expectedPath =
        `/storage/v1/object/public/avatars/${user.id}/`;

      if (
        imageUrl.origin !== supabaseUrl.origin ||
        !imageUrl.pathname.startsWith(expectedPath) ||
        imageUrl.pathname.length <= expectedPath.length ||
        imageUrl.search ||
        imageUrl.hash
      ) {
        return {
          success: false,
          message: "Invalid profile picture URL.",
        };
      }
    } catch {
      return {
        success: false,
        message: "Invalid profile picture URL.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      avatar_url: avatarUrl,
    })
    .eq("id", user.id);

  if (error) {
    console.error("Avatar URL update failed:", error.message);

    return {
      success: false,
      message: "Unable to update your profile picture.",
    };
  }

  revalidatePath("/", "layout");
  revalidatePath("/settings");

  return {
    success: true,
    message: avatarUrl
      ? "Profile picture updated successfully."
      : "Profile picture removed successfully.",
  };
}
