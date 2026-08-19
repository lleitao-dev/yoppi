import { expect, test, type Browser, type Page } from '@playwright/test';

async function enterGuest(page: Page, displayName: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Enter Yoppi' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a game' })).toBeVisible();
}

async function openPoker(page: Page): Promise<void> {
  await page.getByRole('link', { name: /Open Texas Hold'em/ }).click();
  await expect(page.getByRole('heading', { name: "Texas Hold'em" })).toBeVisible();
}

async function createTwoPlayers(browser: Browser) {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  return { aliceContext, bobContext, alice, bob };
}

async function foldCurrentPlayer(pages: Page[]): Promise<void> {
  await expect.poll(async () => {
    for (const page of pages) {
      if (await page.getByRole('button', { name: 'Fold' }).isVisible().catch(() => false)) return true;
    }
    return false;
  }).toBe(true);

  for (const page of pages) {
    const fold = page.getByRole('button', { name: 'Fold' });
    if (await fold.isVisible().catch(() => false)) {
      await fold.click();
      return;
    }
  }
}

test('two guests can start and complete a Texas Holdem hand', async ({ browser }) => {
  const { aliceContext, bobContext, alice, bob } = await createTwoPlayers(browser);
  try {
    await enterGuest(alice, 'Alice Poker');
    await openPoker(alice);
    await alice.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await enterGuest(bob, 'Bob Poker');
    await openPoker(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click();

    await expect(alice.getByText('Bob Poker')).toBeVisible();
    await bob.getByRole('button', { name: "Start Texas Hold'em" }).click();

    await expect(alice.getByTestId('poker-table')).toBeVisible();
    await expect(bob.getByTestId('poker-table')).toBeVisible();
    await expect(alice.getByText('Blinds 10/20')).toBeVisible();

    await foldCurrentPlayer([alice, bob]);

    await expect(alice.getByRole('heading', { name: 'Hand complete' })).toBeVisible();
    await expect(bob.getByRole('heading', { name: 'Hand complete' })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Next hand' })).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test('an active Poker room queues and admits a third player between hands', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  try {
    await enterGuest(alice, 'Alice Poker Queue');
    await openPoker(alice);
    await alice.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await enterGuest(bob, 'Bob Poker Queue');
    await openPoker(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click();
    await alice.getByRole('button', { name: "Start Texas Hold'em" }).click();

    await enterGuest(charlie, 'Charlie Poker Queue');
    await openPoker(charlie);
    await charlie.getByLabel('Room code').fill(roomCode!);
    await charlie.getByRole('button', { name: 'Join room' }).click();
    await expect(charlie.getByTestId('queued-player-notice')).toContainText('next hand');
    await expect(charlie.getByText(/Charlie Poker Queue · queued · online/)).toBeVisible();

    await foldCurrentPlayer([alice, bob]);
    await expect(charlie.getByText(/Charlie Poker Queue · playing · online/)).toBeVisible();
    await expect(charlie.getByTestId('queued-player-notice')).toHaveCount(0);

    await alice.getByRole('button', { name: 'Next hand' }).click();
    await expect(charlie.getByTestId('poker-table')).toBeVisible();
    await expect(charlie.getByText('Charlie Poker Queue')).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await charlieContext.close();
  }
});
