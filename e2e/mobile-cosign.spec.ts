import { expect, test } from "@playwright/test";

test("Мобильный кабинет Второй руки помещается в экран 375 × 812", async ({ page }) => {
  await page.goto("/cosign?userId=usr_arman");
  await expect(page.getByRole("heading", { name: "Арман Сатыбалдиев" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Устройство для второй подписи" })).toBeVisible();

  const topbar = page.getByRole("banner");
  await expect(topbar).toBeVisible();
  await expect.poll(() => topbar.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(80);
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  )).toBeLessThanOrEqual(375);
});
