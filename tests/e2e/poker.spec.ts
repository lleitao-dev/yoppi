import { expect, test, type Browser, type Page } from '@playwright/test';

async function enterGuest(page: Page, displayName: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Display name').fill(displayName);
  await page.getByRole('button', { name: 'Enter Yoppi' }).click({ timeout: 5_000 });
  await expect(page.getByRole('heading', { name: 'Choose a game' })).toBeVisible();
}

async function openPoker(page: Page): Promise<void> {
  await page.locator('a[href="/games/poker"]').click({ timeout: 5_000 });
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
  try {
    await expect
      .poll(
        async () => {
          const counts = await Promise.all(
            pages.map((page) =>
              page
                .locator('button:enabled')
                .filter({ hasText: /^Fold$/ })
                .count(),
            ),
          );
          return counts.reduce((total, count) => total + count, 0);
        },
        {
          message: 'expected exactly one player to have an enabled Fold action',
          timeout: 8_000,
        },
      )
      .toBe(1);
  } catch (error) {
    const states = await Promise.all(
      pages.map(async (page, index) => {
        const table = page.getByTestId('poker-table');
        const tableCount = await table.count();
        return {
          page: index + 1,
          url: page.url(),
          table:
            tableCount === 1 ? await table.innerText({ timeout: 1_000 }).catch(() => null) : null,
          buttons: await page.locator('button').allTextContents(),
          body: (
            await page
              .locator('body')
              .innerText({ timeout: 1_000 })
              .catch(() => '')
          ).slice(0, 4_000),
        };
      }),
    );
    throw new Error(
      `No enabled Fold action appeared. Poker table states: ${JSON.stringify(states)}`,
      { cause: error },
    );
  }

  for (const page of pages) {
    const fold = page.locator('button:enabled').filter({ hasText: /^Fold$/ });
    if ((await fold.count()) === 1) {
      await fold.click({ timeout: 1_500 });
      return;
    }
  }

  throw new Error('No enabled Fold action was found after the action wait completed.');
}

test('two guests can start and complete a Texas Holdem hand', async ({ browser }) => {
  const { alice, bob } = await createTwoPlayers(browser);

  await test.step('create Alice room', async () => {
    await enterGuest(alice, 'Alice Poker');
    await openPoker(alice);
    await alice.getByRole('button', { name: 'Create room' }).click({ timeout: 5_000 });
  });

  const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  await test.step('join Bob and wait for realtime presence', async () => {
    await enterGuest(bob, 'Bob Poker');
    await openPoker(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click({ timeout: 5_000 });
    await expect(alice.getByText(/^2 connected · 2\/6 members$/)).toBeVisible();
  });

  await test.step('start Poker', async () => {
    const start = bob.getByRole('button', { name: "Start Texas Hold'em" });
    await expect(start).toBeEnabled();
    await start.click({ timeout: 5_000 });
    await expect(alice.getByTestId('poker-table')).toBeVisible();
    await expect(bob.getByTestId('poker-table')).toBeVisible();
    await expect(alice.getByText('Blinds 10/20')).toBeVisible();
  });

  await test.step('fold current player', async () => {
    await foldCurrentPlayer([alice, bob]);
  });

  await test.step('observe hand completion', async () => {
    await expect(alice.getByRole('heading', { name: 'Hand complete' })).toBeVisible();
    await expect(bob.getByRole('heading', { name: 'Hand complete' })).toBeVisible();
    await expect(alice.getByRole('button', { name: 'Next hand' })).toBeVisible();
  });
});

test('an active Poker room queues and admits a third player between hands', async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();
  const charlie = await charlieContext.newPage();

  await test.step('create Alice room', async () => {
    await enterGuest(alice, 'Alice Poker Queue');
    await openPoker(alice);
    await alice.getByRole('button', { name: 'Create room' }).click({ timeout: 5_000 });
  });

  const roomCode = (await alice.getByTestId('room-code').textContent())?.trim();
  expect(roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

  await test.step('join Bob and start Poker', async () => {
    await enterGuest(bob, 'Bob Poker Queue');
    await openPoker(bob);
    await bob.getByLabel('Room code').fill(roomCode!);
    await bob.getByRole('button', { name: 'Join room' }).click({ timeout: 5_000 });
    await expect(alice.getByText(/^2 connected · 2\/6 members$/)).toBeVisible();
    const start = alice.getByRole('button', { name: "Start Texas Hold'em" });
    await expect(start).toBeEnabled();
    await start.click({ timeout: 5_000 });
    await expect(alice.getByTestId('poker-table')).toBeVisible();
    await expect(bob.getByTestId('poker-table')).toBeVisible();
  });

  await test.step('queue Charlie', async () => {
    await enterGuest(charlie, 'Charlie Poker Queue');
    await openPoker(charlie);
    await charlie.getByLabel('Room code').fill(roomCode!);
    await charlie.getByRole('button', { name: 'Join room' }).click({ timeout: 5_000 });
    await expect(charlie.getByTestId('queued-player-notice')).toContainText('next hand');
    await expect(charlie.getByText(/Charlie Poker Queue · queued · online/)).toBeVisible();
  });

  await test.step('finish current hand', async () => {
    await foldCurrentPlayer([alice, bob]);
  });

  await test.step('admit Charlie', async () => {
    await expect(charlie.getByText(/Charlie Poker Queue · playing · online/)).toBeVisible();
    await expect(charlie.getByTestId('queued-player-notice')).toHaveCount(0);
  });

  await test.step('start next hand', async () => {
    const next = alice.getByRole('button', { name: 'Next hand' });
    await expect(next).toBeEnabled();
    await next.click({ timeout: 5_000 });
    await expect(charlie.getByTestId('poker-table')).toBeVisible();
    await expect(charlie.getByRole('heading', { name: 'Charlie Poker Queue' })).toBeVisible();
  });
});
