"use client";

// Projet actif côté navigateur : un cookie lu aussi par le serveur (pages et chat).
export const PROJECT_COOKIE = "markova_project";
export const PROJECT_EVENT = "markova:projects";

export function getCurrentProjectId(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${PROJECT_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) || null : null;
}

export function setCurrentProjectId(id: string | null) {
  document.cookie = id
    ? `${PROJECT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
    : `${PROJECT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
