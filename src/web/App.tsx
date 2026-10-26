import { useEffect } from "react";
import { game, useGame } from "./lib/store";
import { ConnectionBadge, Toasts } from "./components/ui";
import { Home } from "./screens/Home";
import { Lobby } from "./screens/Lobby";
import { Countdown, Question, Reveal, Scoreboard } from "./screens/Match";
import { Results } from "./screens/Results";

const PHASE_LABEL: Record<string, string> = {
  LOBBY: "Lobby",
  COUNTDOWN: "Match starting",
  QUESTION: "Question open",
  REVEAL: "Answer revealed",
  SCOREBOARD: "Standings",
  RESULTS: "Final results",
};

export function App() {
  const { status, snap } = useGame();

  useEffect(() => {
    void game.resume();
  }, []);

  useEffect(() => {
    if (snap && (status === "connected" || status === "reconnecting")) {
      history.replaceState(null, "", `/join/${snap.code}`);
    } else if (status === "idle" || status === "lost") {
      if (!/^\/join\//.test(location.pathname)) history.replaceState(null, "", "/");
    }
  }, [snap?.code, status]);

  useEffect(() => {
    document.title = snap ? `${snap.code} | Brainwave Blitz` : "Brainwave Blitz";
  }, [snap?.code]);

  const inRoom = !!snap && (status === "connected" || status === "reconnecting");

  let screen;
  if (!inRoom) screen = <Home />;
  else {
    switch (snap.phase) {
      case "COUNTDOWN":
        screen = <Countdown snap={snap} />;
        break;
      case "QUESTION":
        screen = <Question snap={snap} />;
        break;
      case "REVEAL":
        screen = <Reveal snap={snap} />;
        break;
      case "SCOREBOARD":
        screen = <Scoreboard snap={snap} />;
        break;
      case "RESULTS":
        screen = <Results snap={snap} />;
        break;
      default:
        screen = <Lobby snap={snap} />;
    }
  }

  return (
    <>
      <div className="atmosphere" />
      <ConnectionBadge />
      <div className="sr-only" aria-live="polite" role="status">
        {inRoom ? PHASE_LABEL[snap.phase] : ""}
      </div>
      {screen}
      <Toasts />
    </>
  );
}
