/** Orbe animé de l'IA : calme au repos, s'accélère quand MARKOVA réfléchit, rougit quand il écoute. */
export default function Orb({ size = 40, state = "idle", className = "" }: { size?: number; state?: "idle" | "busy" | "listening"; className?: string }) {
  return (
    <span
      aria-hidden
      className={`orb inline-block shrink-0 ${state === "busy" ? "is-busy" : state === "listening" ? "is-listening" : ""} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
