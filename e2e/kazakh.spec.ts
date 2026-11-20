import { expect, test } from "@playwright/test";

test("Қазақша интерфейс және ұлына SMS-сіз аударым", async ({ page, request, baseURL }) => {
  const resetUrl = new URL("/api/demo/reset", baseURL);
  const reset = () => request.post(resetUrl.href, {
    headers: { Origin: resetUrl.origin },
    data: { keepDevices: true },
  });
  await expect(await reset()).toBeOK();
  try {
    await page.goto("/");
    const html = page.locator("html");
    const topbar = page.getByRole("banner");
    await expect(html).toHaveAttribute("lang", "ru");
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await topbar.getByRole("button", { name: /^ҚАЗ/ }).click();
    await expect(html).toHaveAttribute("lang", "kk");
    await expect(page).toHaveURL(/[?&]lang=kk(?:&|$)/);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(page.getByRole("heading", { name: /Тәуекелді бағалау/ })).toBeVisible();

    await topbar.getByRole("button", { name: "Құрылғыны 5 секундта байланыстыру" }).click();
    const device = page.getByRole("dialog", { name: "Құрылғыны байланыстыру" });
    await device.getByRole("checkbox", { name: /Software Key/ }).check();
    await device.getByRole("button", { name: "Құрылғыны байланыстыру", exact: true }).click();
    await expect(device).toBeHidden();

    await page.getByRole("button", { name: "Ұлыма · 15 000 ₸" }).click();
    await page.getByRole("button", { name: /^SMS-сіз қол қою/ }).click();
    const review = page.getByRole("dialog", { name: "Операцияны растау (WYSIWYS)" });
    await expect(review.getByText("На продукты", { exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Software Key + ML-DSA арқылы растау" }).click();
    await expect(page.getByRole("heading", { name: "Операция SMS-сіз орындалды" })).toBeVisible();

    await topbar.getByRole("link", { name: "SOC орталығы" }).click();
    await expect(page.getByRole("heading", { name: "БЦК SOC орталығы" })).toBeVisible();
    // A direct visit without lang must recover the preference from storage.
    await page.goto("/roi");
    await expect(page.getByRole("heading", { name: "«Банк ЦентрКредит» АҚ үшін ROI калькуляторы" })).toBeVisible();
    await topbar.getByRole("link", { name: "Екінші қол" }).click();
    await expect(page.getByRole("heading", { name: "Екінші қолтаңбаға арналған құрылғы" })).toBeVisible();

    await topbar.getByRole("button", { name: "Навигация мәзірін ашу" }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^РУС/ }).click();
    await expect(html).toHaveAttribute("lang", "ru");
    await expect(page).toHaveURL(/[?&]lang=ru(?:&|$)/);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Оценка риска/ })).toBeVisible();
  } finally {
    await expect(await reset()).toBeOK();
  }
});
