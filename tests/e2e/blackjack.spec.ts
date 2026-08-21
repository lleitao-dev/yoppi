import { expect, test, type Browser, type Page } from '@playwright/test';

async function enterGuest(page: Page, displayName: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Enter Yoppi' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a game' })).toBeVisible();
}

async function openBlackjack(page: Page): Promise<void> {
  await page.getByRole('link', { name: /Open Blackjack/ }).click();
  await expect(page.getByRole('heading', { name: 'Blackjack' })).toBeVisible();
}

async function completeRound(alice: Page, bob: Page): Promise<void> {
  for (let action = 0; action < 3; action += 1) {
    await expect
      .poll(async () => {
        if (
          await alice
            .getByRole('heading', { name: 'Round complete' })
            .isVisible()
            .catch(() => false)
        )
          return 'complete';
        if (
          await alice
            .getByRole('button', { name: 'Stand' })
            .isVisible()
            .catch(() => false)
        )
          return 'alice';
        if (
          await bob
            .getByRole('button', { name: 'Stand' })
            .isVisible()
            .catch(() => false)
        )
          return 'bob';
        return 'waiting';
      })
      .not.toBe('waiting');

    // expect.poll assertions do not return the polled value, so inspect once more after the wait.
    if (
      await alice
        .getByRole('heading', { name: 'Round complete' })
        .isVisible()
        .catch(() => false)
    )
      return;
    if (
      await alice
        .getByRole('button', { name: 'Stand' })
        .isVisible()
        .catch(() => false)
    ) {
      await alice.getByRole('button', { name: 'Stand' }).click();
      continue;
    }
    if (
      await bob
        .getByRole('button', { name: 'Stand' })
        .isVisible()
        .catch(() => false)
    ) {
      await bob.getByRole('button', { name: 'Stand' }).click();
      continue;
    }
  }
}

async function createPlayers(browser: Browser) {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  return {
    aliceContext,
    bobContext,
    alice: await aliceContext.newPage(),
    bob: await bobContext.newPage(),
  };
}

test('two guests can play a Blackjack round in one room', async ({ browser }) => {
  const { aliceContext, bobContext, alice, bob } = await createPlayers(browser);

  try {
    await enterGuest(alice, 'Alice E2E');
    await openBlackjack(alice);
    await alice.getByRole('button', { name: 'Create room' }).click();
    await expect(alice.getByText('Waiting room')).toBeVisible();
    const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await enterGuest(bob, 'Bob E2E');
    await openBlackjack(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click();

    await expect(alice.getByText('Bob E2E')).toBeVisible();
    await expect(bob.getByText('Alice E2E')).toBeVisible();

    // Start authority is capability-based: Bob is not the host, but may start once the minimum is met.
    await bob.getByRole('button', { name: 'Start Blackjack' }).click();
    await expect(alice.getByText('Live table')).toBeVisible();
    await expect(bob.getByText('Live table')).toBeVisible();

    await alice.getByRole('button', { name: 'Place bet' }).click();
    await bob.getByRole('button', { name: 'Place bet' }).click();

    // A natural blackjack may skip a player's turn. Stand whichever seated player is prompted.
    await completeRound(alice, bob);

    await expect(alice.getByRole('heading', { name: 'Round complete' })).toBeVisible();
    await expect(bob.getByRole('heading', { name: 'Round complete' })).toBeVisible();

    await expect(alice.getByRole('button', { name: 'Next round' })).toBeVisible();
    await alice.getByRole('button', { name: 'Next round' }).click();
    await expect(alice.getByRole('button', { name: 'Place bet' })).toBeVisible();
    await expect(bob.getByRole('button', { name: 'Place bet' })).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

async function completeRoundFromOneRemainingPage(page: Page): Promise<void> {
  for (let action = 0; action < 4; action += 1) {
    await expect
      .poll(async () => {
        if (
          await page
            .getByRole('heading', { name: 'Round complete' })
            .isVisible()
            .catch(() => false)
        )
          return 'complete';
        if (
          await page
            .getByRole('button', { name: 'Stand' })
            .isVisible()
            .catch(() => false)
        )
          return 'stand';
        return 'waiting';
      })
      .not.toBe('waiting');

    if (
      await page
        .getByRole('heading', { name: 'Round complete' })
        .isVisible()
        .catch(() => false)
    )
      return;
    await page.getByRole('button', { name: 'Stand' }).click();
  }
}

test('active host transfers and the disconnected member can re-enter by code', async ({
  browser,
}) => {
  const { aliceContext, bobContext, alice, bob } = await createPlayers(browser);

  try {
    await enterGuest(alice, 'Alice Transfer');
    await openBlackjack(alice);
    await alice.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await enterGuest(bob, 'Bob Transfer');
    await openBlackjack(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click();
    await expect(bob.getByText('Alice Transfer')).toBeVisible();

    await bob.getByRole('button', { name: 'Start Blackjack' }).click();
    await alice.getByRole('button', { name: 'Place bet' }).click();
    await bob.getByRole('button', { name: 'Place bet' }).click();

    await alice.close();
    await expect(bob.getByText(/Bob Transfer · host · playing · online/)).toBeVisible();

    await completeRoundFromOneRemainingPage(bob);
    await expect(bob.getByRole('button', { name: 'Next round' })).toBeVisible();

    const aliceReconnected = await aliceContext.newPage();
    await aliceReconnected.goto('/games/blackjack');
    await aliceReconnected.getByLabel('Room code').fill(roomCode!);
    await aliceReconnected.getByRole('button', { name: 'Join room' }).click();
    await expect(aliceReconnected.getByText('Live table')).toBeVisible();
    await expect(aliceReconnected.getByText(/Alice Transfer · playing · online/)).toBeVisible();
    await expect(
      aliceReconnected.getByText(/Bob Transfer · host · playing · online/),
    ).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

async function completeRoundForPages(pages: Page[]): Promise<void> {
  for (let action = 0; action < 8; action += 1) {
    const complete = await pages[0]
      .getByRole('heading', { name: 'Round complete' })
      .isVisible()
      .catch(() => false);
    if (complete) return;

    let acted = false;
    for (const page of pages) {
      const stand = page.getByRole('button', { name: 'Stand' });
      const actionable = await stand
        .isVisible()
        .then(async (visible) => visible && (await stand.isEnabled()))
        .catch(() => false);
      if (actionable) {
        await stand.click();
        acted = true;
        break;
      }
    }

    if (!acted) {
      await pages[0].waitForTimeout(100);
    }
  }

  await expect(pages[0].getByRole('heading', { name: 'Round complete' })).toBeVisible();
}

test('active Blackjack queues new players and applies joins and leaves at round boundaries', async ({
  browser,
}) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  try {
    await enterGuest(alice, 'Alice Queue');
    await openBlackjack(alice);
    await alice.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await enterGuest(bob, 'Bob Queue');
    await openBlackjack(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click();
    await expect(alice.getByText(/^2 connected · 2\/5 members$/)).toBeVisible();

    await alice.getByRole('button', { name: 'Start Blackjack' }).click();
    await expect(bob.getByText('Live table')).toBeVisible();

    // Join while the current round is still in BETTING, which is not an admission boundary.
    await enterGuest(charlie, 'Charlie Queue');
    await openBlackjack(charlie);
    await charlie.getByLabel('Room code').fill(roomCode!);
    await charlie.getByRole('button', { name: 'Join room' }).click();
    await expect(charlie.getByTestId('queued-player-notice')).toBeVisible();
    await expect(charlie.getByText(/Charlie Queue · queued · online/)).toBeVisible();
    await expect(charlie.getByRole('button', { name: 'Place bet' })).toHaveCount(0);

    await expect(alice.getByRole('button', { name: 'Place bet' })).toBeEnabled();
    await alice.getByRole('button', { name: 'Place bet' }).click();
    await expect(bob.getByRole('button', { name: 'Place bet' })).toBeEnabled();
    await bob.getByRole('button', { name: 'Place bet' }).click();
    await completeRoundForPages([alice, bob]);

    await expect(charlie.getByText(/Charlie Queue · playing · online/)).toBeVisible();
    await expect(charlie.getByTestId('queued-player-notice')).toHaveCount(0);

    await alice.getByRole('button', { name: 'Next round' }).click();
    await expect(charlie.getByRole('button', { name: 'Place bet' })).toBeVisible();

    // Bob deliberately leaves during BETTING. He is skipped safely and removed at the next boundary.
    await bob.getByRole('button', { name: 'Leave after this round' }).click();
    await expect(bob.getByRole('heading', { name: 'Blackjack' })).toBeVisible();

    await alice.getByRole('button', { name: 'Place bet' }).click();
    await charlie.getByRole('button', { name: 'Place bet' }).click();
    await completeRoundForPages([alice, charlie]);

    await expect(alice.getByText(/Bob Queue ·/)).toHaveCount(0);
    await expect(alice.getByText(/Charlie Queue · playing · online/)).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
    await charlieContext.close();
  }
});

test('single-player Blackjack returns to the waiting room after the minimum-player grace expires', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await enterGuest(page, 'Alice Grace Expire');
    await openBlackjack(page);
    await page.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await page.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await page.getByRole('button', { name: 'Start Blackjack' }).click();
    await expect(page.getByText('Live table')).toBeVisible();
    await page.close();

    await new Promise((resolve) => setTimeout(resolve, 16_000));

    const reconnected = await context.newPage();
    await reconnected.goto('/games/blackjack');
    await reconnected.getByLabel('Room code').fill(roomCode!);
    await reconnected.getByRole('button', { name: 'Join room' }).click();
    await expect(reconnected.getByText('Waiting room')).toBeVisible();
    await expect(reconnected.getByRole('button', { name: 'Start Blackjack' })).toBeEnabled();
  } finally {
    await context.close();
  }
});

test('reconnecting before the grace deadline keeps the active Blackjack game alive', async ({
  browser,
}) => {
  test.setTimeout(45_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await enterGuest(page, 'Alice Grace Cancel');
    await openBlackjack(page);
    await page.getByRole('button', { name: 'Create room' }).click();
    const roomCode = (await page.getByTestId('room-code').textContent())?.trim();
    expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

    await page.getByRole('button', { name: 'Start Blackjack' }).click();
    await expect(page.getByText('Live table')).toBeVisible();
    await page.close();

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    const reconnected = await context.newPage();
    await reconnected.goto('/games/blackjack');
    await reconnected.getByLabel('Room code').fill(roomCode!);
    await reconnected.getByRole('button', { name: 'Join room' }).click();
    await expect(reconnected.getByText('Live table')).toBeVisible();

    await reconnected.waitForTimeout(14_000);
    await expect(reconnected.getByText('Live table')).toBeVisible();
    await expect(reconnected.getByText('Waiting room')).toHaveCount(0);
  } finally {
    await context.close();
  }
});
