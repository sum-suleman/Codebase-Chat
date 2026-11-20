import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { listUserConversations } from "@/lib/chat/conversations";
import { listUserActiveRepositories } from "@/lib/repositories/manage";
import {
  createClient,
  getCachedProfile,
  getCachedUser,
} from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCachedUser();

  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const [profile, activeRepos, recentConversations] = await Promise.all([
    getCachedProfile(user.id),
    listUserActiveRepositories(supabase).catch(() => []),
    listUserConversations(supabase, 15).catch(() => []),
  ]);

  const userFullName =
    profile?.display_name || user.user_metadata?.full_name || "Developer";
  const userEmail = user.email || "";
  const userAvatarUrl = profile?.avatar_url || "";

  const paletteRepositories = activeRepos.map((repo) => ({
    id: repo.id,
    fullName: repo.fullName,
    provider: repo.provider,
    defaultBranch: repo.defaultBranch,
  }));

  const paletteConversations = recentConversations.map((conv) => ({
    id: conv.id,
    title: conv.title,
    repositoryFullName: conv.repositoryFullName,
  }));

  return (
    <AppShell
      userFullName={userFullName}
      userEmail={userEmail}
      userAvatarUrl={userAvatarUrl}
      repositories={paletteRepositories}
      recentConversations={paletteConversations}
    >
      {children}
    </AppShell>
  );
}
