import { expect, type Locator, test } from '@playwright/test';

const CITY = 'ornek-test-sehri';

/** Number of rendered line boxes the element's text occupies. */
function lineBoxes(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const tops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));
    return tops.size;
  });
}

test('line codes never break at the hyphen on a 360 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/hat/ornek-hat-1?city=${CITY}`);
  const title = page.locator('h1.name');
  await expect(title).toContainText('[ÖRNEK] Hat ORN-1');
  const code = title.locator('iv-keep-codes .code');
  await expect(code).toHaveText('ORN-1');
  expect(await lineBoxes(code)).toBe(1);
  // The plate beside the title keeps the code on one line as well.
  expect(await lineBoxes(page.locator('.hero .plate'))).toBe(1);
  // Where the title wraps depends on the width (a Pixel 8 is 412 px wide); sweep the phone range
  // so that the width at which `ORN-` would end a line is covered.
  for (let width = 320; width <= 480; width += 4) {
    await page.setViewportSize({ width, height: 800 });
    expect(await lineBoxes(code), `${width} px`).toBe(1);
  }
  await page.setViewportSize({ width: 360, height: 800 });

  await page.goto('/ara');
  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), CITY);
  await page.reload();
  await page.locator('iv-search-page ion-searchbar input').fill('orn-1');
  const card = page.locator('iv-search-page .results iv-line-card', { hasText: 'ORN-1' });
  await expect(card).toBeVisible();
  expect(await lineBoxes(card.locator('.name iv-keep-codes .code'))).toBe(1);
});
