import { useEffect } from "react";
import { CATEGORY_LABELS, type CategoryChoice } from "../../shared/constants";
import { game, useGame, type Snapshot } from "../lib/store";
import { Avatar, Panel, rankedPlayers, ShapeIcon, SHAPES, TeamBadge, TeamCards, useTick, WaveTimer } from "../components/ui";

function categoryLabel(c: string): string {
  return CATEGORY_LABELS[c as CategoryChoice] ?? c;
}

export function Countdown({ snap }: { snap: Snapshot }) {
  const now = useTick(true, 100);
  const left = Math.max(1, Math.ceil((snap.phaseEndsAt - now) / 1000));
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="text-xl text-muted">Get ready. {snap.rounds} questions.</p>
        <p key={left} className="tick-pulse font-display text-[10rem] font-extrabold leading-none text-cyan sm:text-[14rem]">
          {left}
        </p>
        <p className="text-muted">Answers are scored on speed, so stay sharp.</p>
      </div>
    </main>
  );
}

function Options({ snap, mode }: { snap: Snapshot; mode: "answer" | "reveal" }) {
  const { pick } = useGame();
  const q = snap.question;
  const mine = pick && pick.q === q.index ? pick.choice : -1;
  const locked = mine >= 0;
  const revealed = mode === "reveal";
  const total = q.pickCounts.reduce((a, b) => a + b, 0);

  return (
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Answers">
      {q.options.map((text, i) => {
        let state = "idle";
        if (revealed) state = i === q.correctIndex ? "right" : i === mine ? "wrong" : "dim";
        else if (locked) state = i === mine ? "picked" : "dim";
        const shape = SHAPES[i];
        const count = q.pickCounts[i] ?? 0;
        return (
          <button
            key={i}
            className="answer"
            data-state={state}
            style={{ ["--shape-color" as string]: shape?.color }}
            disabled={revealed || locked}
            aria-keyshortcuts={String(i + 1)}
            aria-label={`${shape?.name}, option ${i + 1}: ${text}${revealed && i === q.correctIndex ? ", correct answer" : ""}${i === mine ? ", your pick" : ""}`}
            onClick={() => game.answer(i)}
          >
            <span className="shape">
              <ShapeIcon index={i} />
            </span>
            <span className="flex-1">{text}</span>
            {revealed && (
              <span className="text-sm text-muted" aria-hidden="true">
                {count}/{total}
              </span>
            )}
            {!revealed && <kbd className="hidden text-xs text-muted sm:inline">{i + 1}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

export function Question({ snap }: { snap: Snapshot }) {
  const { pick, acked, myId } = useGame();
  const myTeam = snap.mode === "teams" && myId ? (snap.players[myId]?.team ?? 0) : 0;
  const q = snap.question;
  const now = useTick(true, 100);
  const total = Math.max(1, q.endsAt - q.startedAt);
  const remaining = Math.max(0, q.endsAt - now);
  const secs = Math.ceil(remaining / 1000);
  const locked = pick && pick.q === q.index;
  const players = Object.values(snap.players).filter((p) => !p.left);
  const answered = players.filter((p) => p.answered).length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) game.answer(n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <div className="flex items-center justify-between text-muted">
        <span className="font-display font-semibold text-text">
          Question {q.index + 1} of {q.total}
        </span>
        <span className="flex items-center gap-2">
          <TeamBadge team={myTeam} />
          {categoryLabel(q.category)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <WaveTimer fraction={remaining / total} urgent={secs <= 5} label={`${secs} seconds left`} />
        </div>
        <span
          className={`w-14 text-right font-display text-4xl font-extrabold tabular-nums ${secs <= 5 ? "text-rose" : "text-cyan"}`}
          aria-hidden="true"
        >
          {secs}
        </span>
      </div>

      <h2 className="py-3 text-3xl font-bold leading-tight sm:text-4xl">{q.text}</h2>

      <Options snap={snap} mode="answer" />

      <p className="min-h-6 text-center text-muted" role="status">
        {locked
          ? acked
            ? "Locked in. Waiting for the others."
            : "Sending your answer..."
          : "Pick an answer. Faster is worth more."}
      </p>
      <p className="text-center text-sm text-muted">
        {answered} of {players.length} answered
      </p>
    </main>
  );
}

export function Reveal({ snap }: { snap: Snapshot }) {
  const { myId } = useGame();
  const q = snap.question;
  const me = myId ? snap.players[myId] : undefined;
  const hasPick = !!me && me.lastChoice >= 0;
  const right = !!me?.lastCorrect;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-5 px-4 py-6">
      <div className="flex items-center justify-between text-muted">
        <span className="font-display font-semibold text-text">
          Question {q.index + 1} of {q.total}
        </span>
        <span>{categoryLabel(q.category)}</span>
      </div>
      <h2 className="py-3 text-3xl font-bold leading-tight sm:text-4xl">{q.text}</h2>
      <Options snap={snap} mode="reveal" />
      <Panel className="pop-in text-center" >
        <div role="status">
          {!me ? null : right ? (
            <>
              <p className="font-display text-5xl font-extrabold text-mint">+{me.lastGain}</p>
              <p className="mt-1 text-muted">
                Correct.{me.streak >= 2 ? ` ${me.streak} in a row, streak bonus included.` : ""}
              </p>
            </>
          ) : hasPick ? (
            <>
              <p className="font-display text-4xl font-extrabold text-rose">Not this one</p>
              <p className="mt-1 text-muted">No points this round.</p>
            </>
          ) : (
            <>
              <p className="font-display text-4xl font-extrabold text-muted">Time ran out</p>
              <p className="mt-1 text-muted">You did not answer in time.</p>
            </>
          )}
        </div>
      </Panel>
    </main>
  );
}

export function Scoreboard({ snap }: { snap: Snapshot }) {
  const { myId } = useGame();
  const now = useTick(true, 250);
  const left = Math.max(0, Math.ceil((snap.phaseEndsAt - now) / 1000));
  const list = rankedPlayers(snap.players).filter((p) => !p.left);
  const last = snap.question.index + 1 >= snap.question.total;
  const teamsOn = snap.mode === "teams";
  const myTeam = teamsOn && myId ? (snap.players[myId]?.team ?? 0) : 0;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-4 py-6">
      <header className="flex items-end justify-between">
        <h2 className="text-3xl font-bold">Standings</h2>
        <p className="text-muted">
          {last ? "Final results next" : `Next question in ${left}`}
        </p>
      </header>
      {teamsOn && <TeamCards teams={snap.teams} myTeam={myTeam} />}
      <ol className="space-y-2" aria-label="Leaderboard">
        {list.map((p) => (
          <li
            key={p.id}
            className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${p.id === myId ? "border-cyan bg-cyan/10" : "border-edge bg-panel/70"}`}
          >
            <span className="w-8 font-display text-2xl font-extrabold text-muted">{p.rank}</span>
            <Avatar index={p.avatar} name={p.name} />
            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
            {teamsOn && <TeamBadge team={p.team} short />}
            {p.lastGain > 0 && <span className="text-sm font-semibold text-mint">+{p.lastGain}</span>}
            <span className="w-16 text-right font-display text-xl font-bold tabular-nums">{p.score}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
