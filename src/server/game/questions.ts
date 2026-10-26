import { randomInt } from "node:crypto";
import { CATEGORIES, LIMITS, type Category, type CategoryChoice } from "../../shared/constants";
import { QUESTION_BANK } from "../data/questionBank";

export type Difficulty = 1 | 2 | 3;

export interface BankQuestion {
  id: string;
  category: Category;
  difficulty: Difficulty;
  text: string;
  correct: string;
  wrong: readonly [string, string, string];
}

/** A question as asked in one match: options shuffled, answer key stays on the server. */
export interface AskedQuestion {
  id: string;
  category: Category;
  difficulty: Difficulty;
  text: string;
  options: [string, string, string, string];
  correctIndex: number;
}

export type Rng = (maxExclusive: number) => number;
export const cryptoRng: Rng = (max) => randomInt(max);

export function loadBank(): BankQuestion[] {
  const out: BankQuestion[] = [];
  for (const category of CATEGORIES) {
    QUESTION_BANK[category].forEach((row, i) => {
      const [difficulty, text, correct, w1, w2, w3] = row;
      out.push({ id: `${category}-${i + 1}`, category, difficulty, text, correct, wrong: [w1, w2, w3] });
    });
  }
  return out;
}

export const BANK: readonly BankQuestion[] = loadBank();

/** Returns a list of problems. An empty list means the bank is sound. */
export function validateBank(bank: readonly BankQuestion[]): string[] {
  const problems: string[] = [];
  const seenText = new Set<string>();
  for (const q of bank) {
    const key = q.text.trim().toLowerCase();
    if (seenText.has(key)) problems.push(`${q.id}: duplicate question text`);
    seenText.add(key);
    const options = [q.correct, ...q.wrong];
    if (options.some((o) => o.trim().length === 0)) problems.push(`${q.id}: empty option`);
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== LIMITS.optionCount) {
      problems.push(`${q.id}: options are not four distinct values`);
    }
    if (q.text.length > 160) problems.push(`${q.id}: question too long`);
    if (options.some((o) => o.length > 60)) problems.push(`${q.id}: option too long`);
    if (![1, 2, 3].includes(q.difficulty)) problems.push(`${q.id}: bad difficulty`);
  }
  return problems;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    const tmp = a[i] as T;
    a[i] = a[j] as T;
    a[j] = tmp;
  }
  return a;
}

export function toAsked(q: BankQuestion, rng: Rng): AskedQuestion {
  const tagged = shuffle(
    [
      { text: q.correct, right: true },
      ...q.wrong.map((text) => ({ text, right: false })),
    ],
    rng,
  );
  const options = tagged.map((t) => t.text) as AskedQuestion["options"];
  const correctIndex = tagged.findIndex((t) => t.right);
  return { id: q.id, category: q.category, difficulty: q.difficulty, text: q.text, options, correctIndex };
}

export function poolSize(category: CategoryChoice, bank: readonly BankQuestion[] = BANK): number {
  return category === "mixed" ? bank.length : bank.filter((q) => q.category === category).length;
}

/**
 * Picks `count` questions. Questions in `used` are avoided until the pool runs dry.
 * The final order ramps from easy to hard. Mixed mode caps how many come from one category.
 */
export function selectQuestions(
  category: CategoryChoice,
  count: number,
  used: ReadonlySet<string>,
  rng: Rng = cryptoRng,
  bank: readonly BankQuestion[] = BANK,
): AskedQuestion[] {
  const inScope = category === "mixed" ? [...bank] : bank.filter((q) => q.category === category);
  if (inScope.length === 0) return [];
  const want = Math.min(count, inScope.length);

  let fresh = inScope.filter((q) => !used.has(q.id));
  if (fresh.length < want) {
    // Pool is nearly exhausted: take every unused question, then top up from the rest.
    const rest = shuffle(inScope.filter((q) => used.has(q.id)), rng);
    fresh = [...fresh, ...rest];
  }

  const shuffled = shuffle(fresh, rng);
  const cap = category === "mixed" ? Math.max(2, Math.ceil(want / 4)) : want;
  const perCategory = new Map<Category, number>();
  const picked: BankQuestion[] = [];
  for (const q of shuffled) {
    if (picked.length === want) break;
    const n = perCategory.get(q.category) ?? 0;
    if (n >= cap) continue;
    perCategory.set(q.category, n + 1);
    picked.push(q);
  }
  for (const q of shuffled) {
    if (picked.length === want) break;
    if (!picked.includes(q)) picked.push(q);
  }

  const ramped = picked
    .map((q) => ({ q, tie: rng(1_000_000) }))
    .sort((a, b) => a.q.difficulty - b.q.difficulty || a.tie - b.tie)
    .map((x) => x.q);
  return ramped.map((q) => toAsked(q, rng));
}
