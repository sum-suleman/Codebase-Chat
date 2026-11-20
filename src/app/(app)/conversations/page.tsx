import { redirect } from "next/navigation";

import { ConversationsManager } from "@/components/conversations/conversations-manager";
import { listUserConversations } from "@/lib/chat/conversations";
import { createClient } from "@/lib/supabase/server";

export default async function ConversationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const conversations = await listUserConversations(supabase, 100).catch(
    () => []
  );

  return <ConversationsManager initialConversations={conversations} />;
}
