import { createClient } from "@/lib/supabase/server";
import type { Change, Facts } from "@/lib/veille";
import VeilleBoard, { type CompetitorView } from "./VeilleBoard";

export const dynamic = "force-dynamic";

export default async function VeillePage() {
  const supabase = await createClient();
  const { data: comps, error } = await supabase.from("competitors").select("id, name, urls, notes").eq("active", true).order("name");
  if (error) {
    return (
      <VeilleBoard
        competitors={[]}
        setupError="La base n'est pas encore à jour : relance supabase/schema.sql dans Supabase (SQL Editor → coller → Run), puis recharge la page."
      />
    );
  }
  const ids = (comps ?? []).map((c) => c.id as string);
  const { data: snaps } = ids.length
    ? await supabase
        .from("competitor_snapshots")
        .select("competitor_id, url, facts, changes, checked_at")
        .in("competitor_id", ids)
        .order("checked_at", { ascending: false })
        .limit(500)
    : { data: [] };

  const competitors: CompetitorView[] = (comps ?? []).map((c) => {
    const mine = (snaps ?? []).filter((s) => s.competitor_id === c.id);
    const pages = (c.urls as string[]).map((url) => {
      const s = mine.find((x) => x.url === url);
      return { url, checkedAt: (s?.checked_at as string) ?? null, facts: (s?.facts as Facts) ?? null };
    });
    const changes = mine
      .flatMap((s) => ((s.changes as Change[]) ?? []).map((ch) => ({ ...ch, date: String(s.checked_at), url: String(s.url) })))
      .slice(0, 15);
    return { id: c.id as string, name: c.name as string, notes: (c.notes as string) ?? null, pages, changes };
  });

  return <VeilleBoard competitors={competitors} />;
}
