import { useMemo, useState } from "react";
import { game, useGame, type Snapshot } from "../lib/store";
import { Avatar, Panel, rankedPlayers } from "../components/ui";
import { shareInvite } from "./Lobby";

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        color: ["#2ee6ff", "#8f6bff", "#f6c453", "#3df0a0", "#ff7a9a"][i % 5],
        dx: `${((i * 53) % 120) - 60}px`,
        delay: `${(i % 8) * 0.12}s`,
        dur: `${3 + (i % 5) * 0.4}s`,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: p.left, background: p.color, ["--dx" as string]: p.dx, ["--delay" as string]: p.delay, ["--dur" as string]: p.dur }} />
      ))}
    </div>
  );
}

export function Results({ snap }: { snap: Snapshot }) {
  const { myId } = useGame();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const list = rankedPlayers(snap.players);
  const winners = list.filter((p) => p.rank === 1 && !p.left);
  const me = myId ? snap.players[myId] : undefined;
  const isHost = !!me?.isHost;
  const iWon = !!me && me.rank === 1;
  const rounds = snap.summaries.length;

  const headline =
    winners.length === 0
      ? "Match over"
      : winners.length === 1
        ? `${winners[0]?.name} wins`
        : `${winners.map((w) => w.name).join(" and ")} tie for first`;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      {iWon && <Confetti />}
      <header className="mb-6 text-center">
        <p className="text-muted">Final results</p>
        <h1 className="mt-1 text-4xl font-extrabold sm:text-6xl">{headline}</h1>
      </header>

      <ol className="space-y-2" aria-label="Final leaderboard">
        {list.map((p) => {
          const acc = rounds > 0 ? Math.round((p.correctCount / rounds) * 100) : 0;
          return (
            <li
              key={p.id}
              className={`rounded-2xl border px-4 py-3 ${p.id === myId ? "border-cyan bg-cyan/10" : "border-edge bg-panel/70"}`}
            >
              <div className="flex items-center gap-3">
                <span className={`w-8 font-display text-2xl font-extrabold ${p.rank === 1 ? "text-gold" : "text-muted"}`}>{p.rank}</span>
                <Avatar index={p.avatar} name={p.name} />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {p.name}
                  {p.left && <span className="ml-2 text-sm font-normal text-muted">left</span>}
                </span>
                <span className="font-display text-2xl font-bold tabular-nums">{p.score}</span>
              </div>
              <p className="mt-1 pl-11 text-sm text-muted">
                {p.correctCount} of {rounds} correct ({acc}%). Best streak {p.bestStreak}.
              </p>
              <div className="mt-2 flex flex-wrap gap-1 pl-11" role="img" aria-label={`Per question results for ${p.name}`}>
                {Array.from({ length: rounds }, (_, i) => {
                  const gain = p.gains[i] ?? 0;
                  const choice = p.choices[i] ?? -1;
                  const cls = gain > 0 ? "bg-mint" : choice >= 0 ? "bg-rose" : "bg-edge";
                  return <span key={i} className={`h-2.5 w-4 rounded-sm ${cls}`} />;
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-muted">Green is correct, red is wrong, grey is no answer.</p>

      <Panel className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {isHost ? (
          <>
            <button className="btn btn-primary" onClick={() => game.playAgain()}>
              Play again
            </button>
            <button className="btn btn-ghost" onClick={() => game.backToLobby()}>
              Back to lobby
            </button>
          </>
        ) : (
          <p className="flex-1 text-muted" role="status">
            Waiting for the host to start another match.
          </p>
        )}
        <span className="flex-1" />
        <button className="btn btn-ghost" onClick={() => shareInvite(snap.code)}>
          Invite friends
        </button>
        {confirmLeave ? (
          <button className="btn btn-ghost" onClick={() => game.leave()}>
            Yes, leave
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmLeave(true)}>
            Leave room
          </button>
        )}
      </Panel>
    </main>
  );
}
