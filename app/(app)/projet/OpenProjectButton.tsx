"use client";

import { setCurrentProjectId } from "@/lib/project-client";
import { Icon } from "@/components/ui";

/** Ouvre un autre projet (il devient le projet en cours). */
export default function OpenProjectButton({ id, name }: { id: string; name: string }) {
  return (
    <button
      onClick={() => {
        setCurrentProjectId(id);
        window.location.href = "/projet";
      }}
      className="btn btn-sm"
    >
      <Icon name="folder" className="text-[18px] text-accent-text" /> {name}
    </button>
  );
}
