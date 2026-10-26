export interface RankInput {
  id: string;
  score: number;
  correctCount: number;
  /** Sum of response times for correct answers, in milliseconds. */
  correctTimeMs: number;
}

export interface Ranked {
  id: string;
  rank: number;
}

function avgCorrectTime(p: RankInput): number {
  return p.correctCount > 0 ? p.correctTimeMs / p.correctCount : Number.POSITIVE_INFINITY;
}

/** Orders by score, then correct answers, then faster average correct time. Equal on all three shares a rank. */
export function rankPlayers(players: readonly RankInput[]): Ranked[] {
  const sorted = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    const ta = avgCorrectTime(a);
    const tb = avgCorrectTime(b);
    if (ta !== tb) return ta - tb;
    return 0;
  });
  const out: Ranked[] = [];
  let prev: RankInput | undefined;
  let prevRank = 0;
  sorted.forEach((p, i) => {
    const tied =
      prev !== undefined &&
      prev.score === p.score &&
      prev.correctCount === p.correctCount &&
      avgCorrectTime(prev) === avgCorrectTime(p);
    const rank = tied ? prevRank : i + 1;
    out.push({ id: p.id, rank });
    prev = p;
    prevRank = rank;
  });
  return out;
}
