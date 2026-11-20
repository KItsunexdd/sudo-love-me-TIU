import { expect, test } from "@playwright/test";

test("Chromium блокирует Passkey банка на учебном клоне", async ({ page, baseURL }) => {
  const bank = new URL("/", baseURL);
  const clone = new URL("http://127.0.0.1/phishing-clone");
  clone.port = bank.port || (bank.protocol === "https:" ? "443" : "80");

  await page.goto(clone.href);
  await page.getByRole("button", { name: "Получить 50 000 ₸ (Passkey)", exact: true }).click();
  const explanation = page.getByRole("alert");
  await expect(explanation.getByRole("heading", { name: "Фишинг заблокирован браузером" })).toBeVisible();
  await expect(explanation.getByText(/Браузер отклонил запрос к ключу другого домена/)).toBeVisible();
});
