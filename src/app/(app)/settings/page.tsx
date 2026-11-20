import { redirect } from "next/navigation";
import { createClient, getCachedProfile } from "@/lib/supabase/server";
import {
  listUserGitHubConnections,
  type GitHubConnectionSummary,
} from "@/lib/providers/github/connections";
import {
  listUserGitLabConnections,
  type GitLabConnectionSummary,
} from "@/lib/providers/gitlab/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { GitHubConnections } from "@/components/settings/github-connections";
import { GitLabConnections } from "@/components/settings/gitlab-connections";
import { ProfileForm } from "@/components/settings/profile-form";
import { SecurityForm } from "@/components/settings/security-form";

interface SettingsPageProps {
  searchParams: Promise<{
    github?: string | string[];
    github_error?: string | string[];
    gitlab?: string | string[];
    gitlab_error?: string | string[];
  }>;
}

function getSingleParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const githubStatus = getSingleParam(resolvedSearchParams.github);
  const githubError = getSingleParam(resolvedSearchParams.github_error);
  const gitlabStatus = getSingleParam(resolvedSearchParams.gitlab);
  const gitlabError = getSingleParam(resolvedSearchParams.gitlab_error);

  const profile = await getCachedProfile(user.id);

  let githubConnections: GitHubConnectionSummary[] = [];
  let githubLoadFailed = false;
  try {
    githubConnections = await listUserGitHubConnections(supabase);
  } catch {
    githubLoadFailed = true;
  }

  let gitlabConnections: GitLabConnectionSummary[] = [];
  let gitlabLoadFailed = false;
  try {
    gitlabConnections = await listUserGitLabConnections(supabase);
  } catch {
    gitlabLoadFailed = true;
  }

  const displayName =
    profile?.display_name ||
    user.user_metadata?.full_name ||
    "Developer";

  const avatarUrl = profile?.avatar_url || "";

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-cb-text-primary">
          Settings
        </h1>

        <p className="text-sm text-cb-text-secondary">
          Manage your connected GitHub and GitLab accounts, profile, and account security.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>

          <CardDescription>
            Connect your GitHub or GitLab.com accounts to import repositories
            into Codebase Chat.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cb-text-secondary">
              GitHub
            </h3>
            <GitHubConnections
              connections={githubConnections}
              statusParam={githubStatus}
              errorParam={githubError}
              loadFailed={githubLoadFailed}
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-cb-text-secondary">
              GitLab.com
            </h3>
            <GitLabConnections
              connections={gitlabConnections}
              statusParam={gitlabStatus}
              errorParam={gitlabError}
              loadFailed={gitlabLoadFailed}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>

          <CardDescription>
            Update your profile picture and personal information.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <ProfileForm
            initialDisplayName={displayName}
            initialAvatarUrl={avatarUrl}
            email={user.email || ""}
            userId={user.id}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account Security</CardTitle>

          <CardDescription>
            Change your password and keep your account secure.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <SecurityForm />
        </CardContent>
      </Card>
    </div>
  );
}
