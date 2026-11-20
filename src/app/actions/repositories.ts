"use server";

import { revalidatePath } from "next/cache";

import { disconnectUserGitLabConnection } from "@/lib/providers/gitlab/client";
import {
  disconnectUserRepository,
  importGitHubRepository,
  importGitLabRepository,
  type UserRepositoryRecord,
} from "@/lib/repositories/manage";
import { createClient } from "@/lib/supabase/server";

export type RepositoryActionResult = {
  success: boolean;
  message: string;
  repository?: UserRepositoryRecord;
};

export async function importGitHubRepositoryAction(
  connectionId: string,
  providerRepoId: string
): Promise<RepositoryActionResult> {
  if (
    typeof connectionId !== "string" ||
    typeof providerRepoId !== "string" ||
    !connectionId.trim() ||
    !providerRepoId.trim()
  ) {
    return {
      success: false,
      message: "Please select a valid GitHub repository to import.",
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

  try {
    const repository = await importGitHubRepository(
      {
        ownerId: user.id,
        connectionId: connectionId.trim(),
        providerRepoId: providerRepoId.trim(),
      },
      supabase
    );

    revalidatePath("/");
    revalidatePath("/repositories");

    return {
      success: true,
      message: `Connected ${repository.fullName} successfully.`,
      repository,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to connect the selected GitHub repository.";

    return {
      success: false,
      message,
    };
  }
}

export async function importGitLabRepositoryAction(
  connectionId: string,
  providerRepoId: string
): Promise<RepositoryActionResult> {
  if (
    typeof connectionId !== "string" ||
    typeof providerRepoId !== "string" ||
    !connectionId.trim() ||
    !providerRepoId.trim()
  ) {
    return {
      success: false,
      message: "Please select a valid GitLab project to import.",
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

  try {
    const repository = await importGitLabRepository(
      {
        ownerId: user.id,
        connectionId: connectionId.trim(),
        providerRepoId: providerRepoId.trim(),
      },
      supabase
    );

    revalidatePath("/");
    revalidatePath("/repositories");

    return {
      success: true,
      message: `Connected ${repository.fullName} from GitLab successfully.`,
      repository,
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to connect the selected GitLab project.";

    return {
      success: false,
      message,
    };
  }
}

export async function disconnectGitLabConnectionAction(
  connectionId: string
): Promise<RepositoryActionResult> {
  if (typeof connectionId !== "string" || !connectionId.trim()) {
    return {
      success: false,
      message: "Please select a valid GitLab connection.",
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

  try {
    await disconnectUserGitLabConnection(
      {
        ownerId: user.id,
        connectionId: connectionId.trim(),
      },
      supabase
    );

    revalidatePath("/");
    revalidatePath("/repositories");
    revalidatePath("/settings");

    return {
      success: true,
      message: "GitLab account disconnected.",
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to disconnect GitLab account.";

    return {
      success: false,
      message,
    };
  }
}

export async function disconnectRepositoryAction(
  repositoryId: string
): Promise<RepositoryActionResult> {
  if (typeof repositoryId !== "string" || !repositoryId.trim()) {
    return {
      success: false,
      message: "Please select a valid repository to disconnect.",
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

  try {
    await disconnectUserRepository(
      {
        ownerId: user.id,
        repositoryId: repositoryId.trim(),
      },
      supabase
    );

    revalidatePath("/");
    revalidatePath("/repositories");

    return {
      success: true,
      message: "Repository disconnected.",
    };
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to disconnect the repository.";

    return {
      success: false,
      message,
    };
  }
}
