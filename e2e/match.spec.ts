import { expect, test, type Browser, type Page } from "@playwright/test";

async function newPlayer(browser: Browser, name: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await page.goto("/");
  await page.locator("#name").fill(name);
  return page;
}

const codeLoc = (p: Page) => p.locator("[aria-label^='Room code']");

async function createRoom(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Create a room" }).click();
  await expect(codeLoc(page)).toBeVisible();
  return (await codeLoc(page).textContent())!.trim();
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.locator("#code").fill(code);
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(codeLoc(page)).toHaveText(code);
}

/**
 * Answers every question. It waits for each question header, clicks an option and moves on.
 * It does not wait for the reveal screen, which lasts only half a second in fast test timing.
 */
async function answerAll(page: Page, rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await expect(page.getByText(`Question ${i + 1} of ${rounds}`).first()).toBeVisible({ timeout: 25_000 });
    const opts = page.getByRole("group", { name: "Answers" }).getByRole("button");
    await opts.nth(i % 4).click({ timeout: 3_000 }).catch(() => undefined);
  }
}

test("two separate browsers play a full match with the same final result", async ({ browser }) => {
  const host = await newPlayer(browser, "Ada");
  const code = await createRoom(host);
  expect(code).toMatch(/^[A-Z2-9]{5}$/);

  const guest = await newPlayer(browser, "Bola", { width: 390, height: 780 });
  await joinRoom(guest, code);

  await expect(host.getByText("Bola")).toBeVisible();
  await expect(guest.getByText("Ada")).toBeVisible();

  await guest.getByRole("button", { name: "Ready", exact: true }).click();
  await expect(host.getByText("Ready", { exact: true })).toBeVisible();

  await host.getByRole("button", { name: "5", exact: true }).first().click();
  await host.getByRole("button", { name: "Start match" }).click();

  await Promise.all([answerAll(host, 5), answerAll(guest, 5)]);

  await expect(host.getByRole("list", { name: "Final leaderboard" })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByRole("list", { name: "Final leaderboard" })).toBeVisible({ timeout: 30_000 });

  const read = async (p: Page) => (await p.getByRole("list", { name: "Final leaderboard" }).innerText()).replace(/\s+/g, " ");
  expect(await read(host)).toBe(await read(guest));

  await expect(guest.getByText("Waiting for the host")).toBeVisible();
  await host.getByRole("button", { name: "Play again" }).click();
  await expect(host.getByText("Get ready")).toBeVisible({ timeout: 10_000 });
  await expect(guest.getByText("Get ready")).toBeVisible({ timeout: 10_000 });
});

test("unknown and malformed codes show clear errors", async ({ browser }) => {
  const p = await newPlayer(browser, "Cy");
  await p.locator("#code").fill("ZZZZZ");
  await p.getByRole("button", { name: "Join", exact: true }).click();
  await expect(p.getByRole("alert")).toContainText(/No room with that code/);
  await p.locator("#code").fill("AB");
  await p.getByRole("button", { name: "Join", exact: true }).click();
  await expect(p.getByText("Room codes have 5 letters or numbers.")).toBeVisible();
});

test("invite link opens the join form and refresh keeps the seat", async ({ browser }) => {
  const host = await newPlayer(browser, "Dee");
  const code = await createRoom(host);
  const guest = await newPlayer(browser, "Eko");
  await guest.goto(`/join/${code}`);
  await guest.locator("#name").fill("Eko");
  await guest.getByRole("button", { name: `Join room ${code}` }).click();
  await expect(codeLoc(guest)).toHaveText(code);
  await guest.reload();
  await expect(codeLoc(guest)).toHaveText(code);
  await expect(host.getByText("Eko")).toHaveCount(1);
});

test("full room rejects the 13th player and two rooms stay separate", async ({ browser }) => {
  const host = await newPlayer(browser, "P1");
  const code = await createRoom(host);
  for (let i = 2; i <= 12; i++) {
    const p = await newPlayer(browser, `P${i}`);
    await joinRoom(p, code);
  }
  const late = await newPlayer(browser, "Late");
  await late.locator("#code").fill(code);
  await late.getByRole("button", { name: "Join", exact: true }).click();
  await expect(late.getByRole("alert")).toContainText("full");

  const other = await newPlayer(browser, "Solo");
  const code2 = await createRoom(other);
  expect(code2).not.toBe(code);
  await expect(other.getByText("P2")).toHaveCount(0);
});

test("team match: split, both teams required, same team results on both devices", async ({ browser }) => {
  const host = await newPlayer(browser, "Ife");
  const code = await createRoom(host);
  const guest = await newPlayer(browser, "Jide", { width: 390, height: 780 });
  await joinRoom(guest, code);

  await host.getByRole("button", { name: "Team A vs Team B" }).click();
  await expect(host.getByRole("heading", { name: /^Team A/ })).toBeVisible();
  await expect(guest.getByRole("heading", { name: /^Team B/ })).toBeVisible();
  await expect(host.getByRole("list", { name: "Team A players" })).toContainText("Ife");
  await expect(host.getByRole("list", { name: "Team B players" })).toContainText("Jide");

  // Putting both players on one team blocks the start.
  await guest.getByRole("button", { name: "Ready", exact: true }).click();
  await guest.getByRole("button", { name: "Switch to Team A" }).click();
  await expect(host.getByRole("button", { name: "Start match" })).toBeDisabled();
  await expect(host.getByText("Each team needs at least one player.")).toBeVisible();
  await guest.getByRole("button", { name: "Switch to Team B" }).click();
  await expect(host.getByRole("button", { name: "Start match" })).toBeEnabled();

  await host.getByRole("button", { name: "5", exact: true }).first().click();
  await host.getByRole("button", { name: "Start match" }).click();
  await Promise.all([answerAll(host, 5), answerAll(guest, 5)]);

  await expect(host.getByRole("group", { name: "Team standings" })).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByRole("group", { name: "Team standings" })).toBeVisible({ timeout: 30_000 });
  await expect(host.getByRole("heading", { level: 1 })).toHaveText(/Team [AB] wins|Teams tie for first/);
  const readTeams = async (p: Page) => (await p.getByRole("group", { name: "Team standings" }).innerText()).replace(/\s+/g, " ").replace(/\byou\b/g, "").replace(/\s+/g, " ").trim();
  expect(await readTeams(host)).toBe(await readTeams(guest));
  const read = async (p: Page) => (await p.getByRole("list", { name: "Final leaderboard" }).innerText()).replace(/\s+/g, " ");
  expect(await read(host)).toBe(await read(guest));

  // Back to lobby keeps the teams.
  await host.getByRole("button", { name: "Back to lobby" }).click();
  await expect(host.getByRole("list", { name: "Team A players" })).toContainText("Ife");
  await expect(guest.getByRole("list", { name: "Team B players" })).toContainText("Jide");
});

test("a region set can be picked and its questions are used", async ({ browser }) => {
  const host = await newPlayer(browser, "Kemi");
  const code = await createRoom(host);
  const guest = await newPlayer(browser, "Lanre");
  await joinRoom(guest, code);
  await host.locator("#category").selectOption("nigeria");
  await expect(guest.locator("#category")).toHaveValue("nigeria");
  await guest.getByRole("button", { name: "Ready", exact: true }).click();
  await host.getByRole("button", { name: "5", exact: true }).first().click();
  await host.getByRole("button", { name: "Start match" }).click();
  await expect(host.getByText("Question 1 of 5").first()).toBeVisible({ timeout: 20_000 });
  await expect(host.getByText("Nigeria", { exact: true })).toBeVisible();
  await expect(guest.getByText("Nigeria", { exact: true })).toBeVisible();
});
