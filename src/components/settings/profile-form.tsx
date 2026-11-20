"use client";

import { useActionState, useRef, useState } from "react";
import { Camera, Loader2, Trash2, UploadCloud } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createClient } from "@/lib/supabase/client";

import {
  updateProfileAction,
  updateAvatarUrlAction,
} from "@/app/actions/profile";

import type { ProfileActionState } from "@/app/actions/profile";

interface ProfileFormProps {
  initialDisplayName: string;
  initialAvatarUrl: string;
  email: string;
  userId: string;
}

const initialState: ProfileActionState = {
  success: true,
  message: "",
};

const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function getAvatarStoragePath(
  avatarUrl: string,
  userId: string,
  supabaseUrl: string
): string | null {
  try {
    const imageUrl = new URL(avatarUrl);
    const projectUrl = new URL(supabaseUrl);

    const prefix = "/storage/v1/object/public/avatars/";

    if (imageUrl.origin !== projectUrl.origin) {
      return null;
    }

    if (!imageUrl.pathname.startsWith(prefix)) {
      return null;
    }

    const path = decodeURIComponent(
      imageUrl.pathname.slice(prefix.length)
    );

    const segments = path.split("/");

    if (
      segments.length !== 2 ||
      segments[0] !== userId ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      return null;
    }

    return path;
  } catch {
    return null;
  }
}

export function ProfileForm({
  initialDisplayName,
  initialAvatarUrl,
  email,
  userId,
}: ProfileFormProps) {
  const [profileState, profileFormAction, isSavingProfile] =
    useActionState(updateProfileAction, initialState);

  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [avatarMessage, setAvatarMessage] = useState("");
  const [avatarError, setAvatarError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const initials =
    initialDisplayName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join("")
      .toUpperCase() || "D";

  async function handleAvatarUpload(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setAvatarMessage("");
    setAvatarError(false);
    setPreviewUrl(null);

    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError(true);
      setAvatarMessage("Please select a JPEG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_AVATAR_SIZE) {
      setAvatarError(true);
      setAvatarMessage("Image size must not exceed 2 MB.");
      event.target.value = "";
      return;
    }

    const temporaryPreview = URL.createObjectURL(file);
    setPreviewUrl(temporaryPreview);
    setIsUploading(true);

    const supabase = createClient();

    const extensionByType: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };

    const filePath = `${userId}/${crypto.randomUUID()}.${extensionByType[file.type]}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const {
        data: { publicUrl },
      } = supabase.storage
        .from("avatars")
        .getPublicUrl(filePath);

      const result = await updateAvatarUrlAction(publicUrl);

      if (!result.success) {
        await supabase.storage.from("avatars").remove([filePath]);
        throw new Error(result.message);
      }

      if (avatarUrl) {
        const oldPath = getAvatarStoragePath(
          avatarUrl,
          userId,
          process.env.NEXT_PUBLIC_SUPABASE_URL!
        );

        if (oldPath && oldPath !== filePath) {
          await supabase.storage.from("avatars").remove([oldPath]);
        }
      }

      setAvatarUrl(publicUrl);
      setAvatarMessage("Profile picture updated successfully.");
    } catch (error) {
      setAvatarError(true);

      setAvatarMessage(
        error instanceof Error
          ? error.message
          : "Unable to upload your profile picture."
      );
    } finally {
      URL.revokeObjectURL(temporaryPreview);
      setPreviewUrl(null);
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleRemoveAvatar() {
    if (!avatarUrl || isUploading) {
      return;
    }

    setIsUploading(true);
    setAvatarMessage("");
    setAvatarError(false);

    try {
      const result = await updateAvatarUrlAction(null);

      if (!result.success) {
        throw new Error(result.message);
      }

      const supabase = createClient();

      const oldPath = getAvatarStoragePath(
        avatarUrl,
        userId,
        process.env.NEXT_PUBLIC_SUPABASE_URL!
      );

      if (oldPath) {
        await supabase.storage.from("avatars").remove([oldPath]);
      }

      setAvatarUrl("");
      setAvatarMessage("Profile picture removed successfully.");
    } catch (error) {
      setAvatarError(true);

      setAvatarMessage(
        error instanceof Error
          ? error.message
          : "Unable to remove your profile picture."
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Profile Picture */}
      <section className="flex flex-col gap-5 border-b border-cb-border pb-8 sm:flex-row sm:items-center">
        <Avatar
          src={previewUrl || avatarUrl || undefined}
          alt="Profile picture"
          fallback={initials}
          size="lg"
          className="h-20 w-20"
        />

        <div className="min-w-0 flex-1 space-y-2">
          <h3 className="text-sm font-semibold text-cb-text-primary">
            Profile Picture
          </h3>

          <p className="text-xs text-cb-text-secondary">
            JPEG, PNG, or WebP. Maximum file size: 2 MB.
          </p>

          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
              disabled={isUploading}
              aria-label="Choose profile picture"
            />

            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Camera className="mr-2 h-4 w-4" />
              )}

              {isUploading ? "Uploading..." : "Upload picture"}
            </Button>

            {avatarUrl && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isUploading}
                onClick={handleRemoveAvatar}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            )}
          </div>

          {avatarMessage && (
            <p
              role="status"
              aria-live="polite"
              className={`text-xs ${
                avatarError ? "text-cb-error" : "text-cb-success"
              }`}
            >
              {avatarMessage}
            </p>
          )}

          <p className="text-xs text-cb-text-secondary">
            Profile pictures are publicly accessible through their image URLs.
          </p>
        </div>
      </section>

      {/* Personal Information */}
      <form action={profileFormAction} className="space-y-6">
        <div className="space-y-2">
          <label
            htmlFor="display_name"
            className="text-sm font-medium text-cb-text-primary"
          >
            Display Name
          </label>

          <Input
            id="display_name"
            name="display_name"
            type="text"
            defaultValue={initialDisplayName}
            placeholder="Enter your display name"
            maxLength={80}
            required
            autoComplete="name"
          />

          <p className="text-xs text-cb-text-secondary">
            This name will be displayed across Codebase Chat.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="email"
            className="text-sm font-medium text-cb-text-primary"
          >
            Email Address
          </label>

          <Input
            id="email"
            type="email"
            value={email}
            disabled
            readOnly
          />

          <p className="text-xs text-cb-text-secondary">
            Your email address cannot be changed here.
          </p>
        </div>

        {profileState.message && (
          <div
            role={profileState.success ? "status" : "alert"}
            className={`rounded-md border p-3 text-sm ${
              profileState.success
                ? "border-cb-success/30 bg-cb-success/10 text-cb-success"
                : "border-cb-error/30 bg-cb-error/10 text-cb-error"
            }`}
          >
            {profileState.message}
          </div>
        )}

        <div className="flex justify-end border-t border-cb-border pt-5">
          <Button
            type="submit"
            isLoading={isSavingProfile}
            disabled={isUploading}
          >
            <UploadCloud className="mr-2 h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </form>
    </div>
  );
}
