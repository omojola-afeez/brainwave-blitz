import { useEffect, useState, type ReactNode } from "react";
import { game, useGame, type PlayerSnap } from "../lib/store";

const HUES = [190, 265, 40, 150, 340, 215, 20, 100, 300, 170, 60, 240];

export function avatarStyle(index: number): { background: string; color: string } {
  const hue = HUES[index % HUES.length] ?? 190;
  return {
    background: `linear-gradient(145deg, hsl(${hue} 85% 62%), hsl(${(hue + 40) % 360} 75% 42%))`,
    color: "#050a1c",
  };
}

export function Avatar({ index, name, size = 40 }: { index: number; name: string; size?: number }) {
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="inline-grid shrink-0 place-items-center rounded-full font-display font-bold"
      style={{ ...avatarStyle(index), width: size, height: size, fontSize: size * 0.46 }}
    >
      {letter}
    </span>
  );
}

/** A logo mark drawn as a brainwave line. */
export function WaveMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M4 34h10l5-16 8 30 7-24 5 10h21" fill="none" stroke="#2ee6ff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Same bar heights every render, so the wave looks like a fixed signal rather than noise. */
const BAR_COUNT = 44;
const BAR_HEIGHTS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const a = Math.sin(i * 0.55) * 0.28 + Math.sin(i * 1.7 + 1) * 0.16;
  return Math.max(0.16, Math.min(1, 0.58 + a));
});

export function WaveTimer({ fraction, urgent, label }: { fraction: number; urgent: boolean; label: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  const lit = Math.ceil(f * BAR_COUNT);
  return (
    <div role="timer" aria-label={label} className="wave" data-urgent={urgent}>
      {BAR_HEIGHTS.map((h, i) => (
        <span key={i} style={{ height: `${h * 100}%`, opacity: i < lit ? 1 : 0.14 }} />
      ))}
    </div>
  );
}

export const SHAPES = [
  { color: "#2ee6ff", name: "Circle", path: <circle cx="12" cy="12" r="7.5" /> },
  { color: "#8f6bff", name: "Diamond", path: <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" /> },
  { color: "#f6c453", name: "Triangle", path: <path d="M12 4 21 19.5H3Z" /> },
  { color: "#ff7a9a", name: "Square", path: <rect x="4.5" y="4.5" width="15" height="15" rx="2" /> },
] as const;

export function ShapeIcon({ index }: { index: number }) {
  const s = SHAPES[index] ?? SHAPES[0];
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {s.path}
    </svg>
  );
}

/** Re-renders about ten times a second while `active`, for countdowns driven by the server clock. */
export function useTick(active: boolean, everyMs = 100): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((n) => n + 1), everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);
  return game.now();
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function ConnectionBadge() {
  const { status } = useGame();
  if (status !== "reconnecting") return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 bg-gold px-4 py-2 text-center text-sm font-semibold text-[#2a1c00]"
    >
      Connection lost. Reconnecting, your seat is held for up to a minute.
    </div>
  );
}

export function Toasts() {
  const { toasts } = useGame();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div key={t.id} className="pop-in rounded-full border border-edge bg-raised px-4 py-2 text-sm shadow-lg">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function sortedPlayers(players: Record<string, PlayerSnap>): PlayerSnap[] {
  return Object.values(players).sort((a, b) => a.order - b.order);
}

export function rankedPlayers(players: Record<string, PlayerSnap>): PlayerSnap[] {
  return Object.values(players).sort((a, b) => a.rank - b.rank || b.score - a.score || a.order - b.order);
}
