import { Suspense } from "react";
import { notFound } from "next/navigation";
import Chat, { type Msg } from "@/components/Chat";
import { createClient } from "@/lib/supabase/server";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: conv } = await supabase.from("conversations").select("id, file_ids").eq("id", id).maybeSingle();
  if (!conv) notFound();

  const [{ data: messages }, { data: files }] = await Promise.all([
    supabase.from("messages").select("id, role, content, meta").eq("conversation_id", id).order("created_at"),
    conv.file_ids?.length
      ? supabase.from("files").select("id, name").in("id", conv.file_ids)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <Suspense>
      <Chat
        key={id}
        conversationId={id}
        initialMessages={(messages ?? []) as Msg[]}
        conversationFiles={files ?? []}
      />
    </Suspense>
  );
}
