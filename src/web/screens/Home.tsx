import { useEffect, useState, type FormEvent } from "react";
import { LIMITS, ERROR_MESSAGES } from "../../shared/constants";
import { isValidRoomCode, normalizeRoomCode } from "../../shared/roomCode";
import { nameSchema } from "../../shared/schemas";
import { game, useGame } from "../lib/store";
import { loadProfile } from "../lib/session";
import { Avatar, Panel, WaveMark } from "../components/ui";

function codeFromPath(): string {
  const m = /^\/join\/([A-Za-z0-9-]{3,12})\/?$/.exec(location.pathname);
  return m?.[1] ? normalizeRoomCode(m[1]) : "";
}

export function Home() {
  const { status, error, notice } = useGame();
  const profile = loadProfile();
  const [name, setName] = useState(profile.name);
  const [avatar, setAvatar] = useState(profile.avatar);
  const [code, setCode] = useState(codeFromPath());
  const [nameError, setNameError] = useState<string | null>(null);
  const invited = codeFromPath() !== "";
  const busy = status === "connecting" || status === "connected";

  useEffect(() => {
    if (!invited) history.replaceState(null, "", "/");
  }, [invited]);

  function checkedName(): string | null {
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setNameError(ERROR_MESSAGES.BAD_NAME);
      document.getElementById("name")?.focus();
      return null;
    }
    setNameError(null);
    return parsed.data;
  }

  async function create(e?: FormEvent) {
    e?.preventDefault();
    const n = checkedName();
    if (n) await game.create(n, avatar);
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const n = checkedName();
    if (!n) return;
    if (!isValidRoomCode(normalizeRoomCode(code))) {
      game.toast("Room codes have 5 letters or numbers.");
      document.getElementById("code")?.focus();
      return;
    }
    await game.join(code, n, avatar);
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-8 px-4 py-10 lg:flex-row lg:items-center lg:gap-14">
      <div className="lg:w-1/2">
        <div className="flex items-center gap-3">
          <WaveMark size={40} />
          <span className="font-display text-xl font-semibold text-muted">Brainwave Blitz</span>
        </div>
        <h1 className="mt-6 text-5xl font-extrabold sm:text-7xl">
          Think fast.
          <br />
          Answer faster.
        </h1>
        <p className="mt-5 max-w-md text-lg text-muted">
          A quick trivia game for 2 to 12 friends. One person makes a room, everyone else joins with a 5 letter code.
          No accounts, no downloads.
        </p>
        <details className="mt-6 max-w-md rounded-2xl border border-edge bg-panel/60 p-4">
          <summary className="cursor-pointer font-display text-lg font-semibold">How it works</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
            <li>Each question has four answers and a timer.</li>
            <li>Correct answers earn points. Faster answers earn more.</li>
            <li>Get answers right in a row for a streak bonus.</li>
            <li>The player with the most points after the last question wins.</li>
          </ul>
        </details>
      </div>

      <Panel className="lg:w-1/2">
        {(notice || error) && (
          <div role="alert" className="mb-5 rounded-xl border border-rose/50 bg-rose/10 p-3 text-sm">
            {error ?? notice}
          </div>
        )}
        {invited && !error && (
          <div className="mb-5 rounded-xl border border-cyan/40 bg-cyan/10 p-3 text-sm">
            You were invited to room <strong className="font-display tracking-widest">{codeFromPath()}</strong>. Enter a
            name and join.
          </div>
        )}
        <form onSubmit={invited ? join : create} className="space-y-5">
          <div>
            <label htmlFor="name" className="mb-2 block font-display font-semibold">
              Your name
            </label>
            <input
              id="name"
              className="field"
              value={name}
              maxLength={LIMITS.nameMax}
              autoComplete="nickname"
              placeholder="Ada"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "name-error" : undefined}
              onChange={(e) => setName(e.target.value)}
            />
            {nameError && (
              <p id="name-error" className="mt-2 text-sm text-rose">
                {nameError}
              </p>
            )}
          </div>

          <fieldset>
            <legend className="mb-2 font-display font-semibold">Pick a color</legend>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
              {Array.from({ length: LIMITS.avatarCount }, (_, i) => (
                <button
                  type="button"
                  key={i}
                  aria-pressed={avatar === i}
                  aria-label={`Color ${i + 1}`}
                  onClick={() => setAvatar(i)}
                  className="grid place-items-center rounded-full p-0.5 outline-offset-2"
                  style={{ boxShadow: avatar === i ? "0 0 0 3px var(--color-cyan)" : "none" }}
                >
                  <Avatar index={i} name={name || "A"} size={34} />
                </button>
              ))}
            </div>
          </fieldset>

          {invited ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="btn btn-primary flex-1" disabled={busy} type="submit">
                {busy ? "Joining..." : `Join room ${code}`}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setCode("");
                  history.replaceState(null, "", "/");
                  location.reload();
                }}
              >
                Use a different code
              </button>
            </div>
          ) : (
            <>
              <button className="btn btn-primary w-full" disabled={busy} type="submit">
                {busy ? "Creating..." : "Create a room"}
              </button>
              <div className="flex items-center gap-3 text-sm text-muted">
                <span className="h-px flex-1 bg-edge" />
                or join a friend
                <span className="h-px flex-1 bg-edge" />
              </div>
            </>
          )}
        </form>

        {!invited && (
          <form onSubmit={join} className="mt-5 flex gap-3">
            <div className="flex-1">
              <label htmlFor="code" className="sr-only">
                Room code
              </label>
              <input
                id="code"
                className="field text-center font-display text-xl uppercase tracking-[0.3em]"
                value={code}
                maxLength={8}
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="CODE"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <button className="btn btn-ghost" disabled={busy} type="submit">
              Join
            </button>
          </form>
        )}
        <p className="mt-5 text-xs text-muted">
          Only your chosen name is shown to the room. Nothing is stored about you after the game.
        </p>
      </Panel>
    </main>
  );
}
