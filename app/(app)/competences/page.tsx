import { loadSkills } from "@/lib/skills";
import SkillsManager from "./SkillsManager";

export const dynamic = "force-dynamic";

export default async function SkillsPage() {
  const skills = await loadSkills();
  return (
    <SkillsManager
      base={skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        source: s.source,
        keywords: s.keywords,
        always_loaded: s.always_loaded,
        prompt: s.prompt,
        rules: s.rules,
      }))}
    />
  );
}
