"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "./ui";

export const NOTIFICATIONS_EVENT = "markova:notifications";

/** Nombre de notifications non lues (rafraîchi toutes les minutes et au retour sur l'onglet). */
export function useUnreadCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const load = async () => {
      const { count } = await createClient().from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
      setCount(count ?? 0);
    };
    load();
    const timer = setInterval(load, 60_000);
    window.addEventListener("focus", load);
    window.addEventListener(NOTIFICATIONS_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener(NOTIFICATIONS_EVENT, load);
    };
  }, []);
  return count;
}

export function UnreadBadge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-danger text-white text-[11px] font-bold grid place-items-center">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Cloche de la barre du haut (mobile). */
export default function NotificationBell() {
  const count = useUnreadCount();
  return (
    <Link href="/notifications" aria-label={`Alertes${count ? ` (${count} non lues)` : ""}`} className="relative grid place-items-center size-9 rounded-lg bg-soft border border-line">
      <Icon name="notifications" filled={count > 0} className="text-[20px]" />
      {count > 0 && (
        <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold grid place-items-center">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
