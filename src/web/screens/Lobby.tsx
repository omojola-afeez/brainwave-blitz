import { useState } from "react";
import { CATEGORY_CHOICES, CATEGORY_LABELS, LIMITS } from "../../shared/constants";
import { game, useGame, type Snapshot, type PlayerSnap } from "../lib/store";
import { Avatar, Panel, sortedPlayers } from "../components/ui";

async function copy(text: string, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    game.toast(ok);
  } catch {
    game.toast("Copy failed. Select the code and copy it by hand.");
  }
}

export function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`;
}

export function shareInvite(code: string): void {
  const url = inviteUrl(code);
  if (navigator.share) {
    navigator.share({ title: "Brainwave Blitz", text: `Join my trivia room ${code}`, url }).catch(() => undefined);
  } else {
    void copy(url, "Invite link copied.");
  }
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  disabled,
  render,
  onPick,
}: {
  label: string;
  value: T;
  options: readonly T[];
  disabled: boolean;
  render: (v: T) => string;
  onPick: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 font-display font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={String(o)}
            type="button"
            className="chip"
            aria-pressed={value === o}
            disabled={disabled}
            onClick={() => onPick(o)}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function PlayerRow({ p, isMe }: { p: PlayerSnap; isMe: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-ink/50 px-3 py-2.5">
      <Avatar index={p.avatar} name={p.name} />
      <span className="min-w-0 flex-1 truncate font-semibold">
        {p.name}
        {isMe && <span className="ml-2 text-sm font-normal text-muted">you</span>}
      </span>
      {p.isHost && <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-gold">Host</span>}
      {!p.connected ? (
        <span className="text-sm text-muted">Reconnecting</span>
      ) : p.isHost ? null : p.ready ? (
        <span className="rounded-full bg-mint/15 px-2.5 py-0.5 text-sm font-semibold text-mint">Ready</span>
      ) : (
        <span className="text-sm text-muted">Not ready</span>
      )}
    </li>
  );
}

export function Lobby({ snap }: { snap: Snapshot }) {
  const { myId } = useGame();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const players = sortedPlayers(snap.players).filter((p) => !p.left);
  const me = players.find((p) => p.id === myId);
  const isHost = !!me?.isHost;
  const connected = players.filter((p) => p.connected);
  const others = connected.filter((p) => !p.isHost);
  const allReady = others.every((p) => p.ready);
  const canStart = isHost && connected.length >= LIMITS.minPlayers && allReady;

  let hint = "";
  if (isHost) {
    if (connected.length < LIMITS.minPlayers) hint = "Waiting for at least one more player.";
    else if (!allReady) hint = "Waiting for everyone to press Ready.";
    else hint = "Everyone is ready. Start when you are.";
  } else {
    hint = me?.ready ? "You are ready. Waiting for the host to start." : "Press Ready when you want to play.";
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-muted">Room code</p>
          <p
            className="font-display text-6xl font-extrabold leading-none tracking-[0.18em] text-cyan sm:text-7xl"
            aria-label={`Room code ${snap.code.split("").join(" ")}`}
          >
            {snap.code}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost" onClick={() => copy(snap.code, "Code copied.")}>
            Copy code
          </button>
          <button className="btn btn-primary" onClick={() => shareInvite(snap.code)}>
            Invite friends
          </button>
        </div>
      </header>

      <div className="grid gap-5 md:grid-cols-5">
        <Panel className="md:col-span-3">
          <h2 className="mb-4 text-2xl font-bold">
            Players <span className="text-muted">{connected.length}/{snap.maxPlayers}</span>
          </h2>
          <ul className="space-y-2" aria-label="Players in the room">
            {players.map((p) => (
              <PlayerRow key={p.id} p={p} isMe={p.id === myId} />
            ))}
          </ul>
        </Panel>

        <Panel className="space-y-5 md:col-span-2">
          <h2 className="text-2xl font-bold">Match settings</h2>
          {!isHost && <p className="text-sm text-muted">Only the host can change these.</p>}
          <fieldset disabled={!isHost} className="space-y-5">
            <div>
              <label htmlFor="category" className="mb-2 block font-display font-semibold">
                Category
              </label>
              <select
                id="category"
                className="field"
                value={snap.category}
                disabled={!isHost}
                onChange={(e) => game.setSettings({ category: e.target.value })}
              >
                {CATEGORY_CHOICES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <Segmented
              label="Questions"
              value={snap.rounds}
              options={LIMITS.roundOptions}
              disabled={!isHost}
              render={String}
              onPick={(v) => game.setSettings({ rounds: v })}
            />
            <Segmented
              label="Seconds per question"
              value={snap.questionSeconds}
              options={LIMITS.questionSecondsOptions}
              disabled={!isHost}
              render={String}
              onPick={(v) => game.setSettings({ questionSeconds: v })}
            />
          </fieldset>
        </Panel>
      </div>

      <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        {isHost ? (
          <button className="btn btn-primary sm:min-w-56" disabled={!canStart} onClick={() => game.start()}>
            Start match
          </button>
        ) : (
          <button
            className={`btn sm:min-w-56 ${me?.ready ? "btn-ghost" : "btn-primary"}`}
            aria-pressed={!!me?.ready}
            onClick={() => game.setReady(!me?.ready)}
          >
            {me?.ready ? "Not ready" : "Ready"}
          </button>
        )}
        <p className="flex-1 text-muted" role="status">
          {hint}
        </p>
        {confirmLeave ? (
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => game.leave()}>
              Yes, leave
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
          </div>
        ) : (
          <button className="btn btn-ghost" onClick={() => setConfirmLeave(true)}>
            Leave room
          </button>
        )}
      </div>
    </main>
  );
}
