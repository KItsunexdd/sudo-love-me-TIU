import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

const toSon = "Сыну · 15 000 ₸";
const toScammer = "«Нацбанк» · 850 000 ₸";
const executed = "Операция выполнена без SMS";
const awaitingCosign = "Ожидает Вторую руку";

async function resetDemo(request: APIRequestContext, baseURL: string | undefined, keepDevices: boolean) {
  const url = new URL("/api/demo/reset", baseURL);
  const response = await request.post(url.href, {
    headers: { "Content-Type": "application/json", Origin: url.origin },
    data: { keepDevices },
    timeout: 10_000,
  });
  await expect(response).toBeOK();
  expect(await response.json()).toMatchObject({ status: "RESET", keepDevices });
}

async function enrollSender(page: Page) {
  const topbar = page.getByRole("banner");
  await topbar.getByRole("button", { name: "Привязать устройство за 5 сек" }).click();
  const dialog = page.getByRole("dialog", { name: "Привязать устройство" });
  await dialog.getByRole("checkbox", { name: /Software Key/ }).check();
  await dialog.getByRole("button", { name: "Привязать устройство", exact: true }).click();
  await expect(topbar.getByText("ECDSA + ML-DSA (Fallback)", { exact: true })).toBeVisible();
}

async function signTransfer(page: Page, preset: string) {
  await page.getByRole("button", { name: preset, exact: true }).click();
  await page.getByRole("button", { name: /^Подписать без SMS/ }).click();
  const dialog = page.getByRole("dialog", { name: "Подтверждение операции (WYSIWYS)" });
  await expect(dialog).toBeVisible();
  const acknowledgement = dialog.getByRole("checkbox", { name: /Я подтверждаю/ });
  if (await acknowledgement.isVisible()) await acknowledgement.check();
  await dialog.getByRole("button", { name: "Подтвердить Software Key + ML-DSA" }).click();
}

let context: BrowserContext | undefined;
let page: Page;

test.beforeAll(async ({ browser, baseURL, request }) => {
  await resetDemo(request, baseURL, false);
  context = await browser.newContext();
  page = await context.newPage();
  // This same-origin JSON document does not open the keystore.
  await page.goto("/api/users");
  await page.evaluate(async () => {
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(name);
        deletion.onsuccess = () => resolve();
        deletion.onerror = () => reject(deletion.error);
        deletion.onblocked = () => reject(new Error(`IndexedDB is open: ${name}`));
      });
    }
  });
  await page.goto("/");
});

test.afterAll(async ({ baseURL, request }) => {
  try {
    await resetDemo(request, baseURL, true);
  } finally {
    await context?.close();
  }
});

test("Сценарий защиты BCC SafeSign", async ({ baseURL }) => {
  test.setTimeout(120_000);
  const main = page.getByRole("main");
  const panels = main.getByRole("group", { name: "Панели демо-стенда" });
  const cosignTab = panels.getByRole("button", { name: /Вторая рука \(Co-Sign Live\)/ });
  const incoming = main.getByRole("region", { name: "Входящие запросы" });
  const shield = main.getByRole("alert").filter({
    has: page.getByRole("heading", { name: "Атака отражена", exact: false }),
  });
  const balanceAfterTransfer = main.getByText("1 185 000 ₸", { exact: true });

  await test.step("Айгуль привязывает Software Key и переводит 15 000 ₸", async () => {
    await enrollSender(page);
    await signTransfer(page, toSon);
    await expect(main.getByRole("heading", { name: executed })).toBeVisible();
    await expect(balanceAfterTransfer).toBeVisible();
  });

  await test.step("Повтор пакета отражён, баланс сохранился", async () => {
    await page.getByRole("button", { name: "Повторить пакет", exact: true }).click();
    await expect(shield.getByText(/ERR_REPLAY_DETECTED/)).toBeVisible();
    const response = await page.request.get("/api/users");
    await expect(response).toBeOK();
    expect(await response.json()).toMatchObject({
      users: expect.arrayContaining([expect.objectContaining({ id: "usr_aigul", balanceTenge: 1_185_000 })]),
    });
    await expect(balanceAfterTransfer).toBeVisible();
  });

  await test.step("Стенд показывает исходную и подменённую суммы", async () => {
    await page.getByRole("switch", { name: "Сумма → 500 000 ₸" }).check();
    await shield.getByRole("button", { name: "Сбросить", exact: true }).click();
    await signTransfer(page, toSon);
    await expect(shield.getByText(/ERR_WYSIWYS_TAMPERED/)).toBeVisible();
    await expect(shield.getByText(/Клиент подписал:\s*15\s000\s₸/)).toBeVisible();
    await expect(shield.getByText(/Сервер получил:\s*500\s000\s₸/)).toBeVisible();
  });

  await test.step("Стенд отклоняет чужой Origin и недействительную подпись ML-DSA-65", async () => {
    await page.getByRole("button", { name: "Чужой Origin" }).click();
    await expect(shield.getByText(/ERR_ORIGIN_MISMATCH/)).toBeVisible();

    await page.getByRole("button", { name: "Сравнить криптослои" }).click();
    const quantum = page.getByRole("dialog", { name: "Квантовая атака (алгоритм Шора)" });
    await quantum.getByRole("button", { name: "Проверить защиту ML-DSA-65" }).click();
    await expect(quantum.getByRole("alert").getByText("ERR_PQ_SIGNATURE_INVALID", { exact: true })).toBeVisible();
    await quantum.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(quantum).toBeHidden();
  });

  await test.step("Арман привязывает Software Key и отклоняет перевод на 850 000 ₸", async () => {
    await shield.getByRole("button", { name: "Сбросить", exact: true }).click();
    await signTransfer(page, toScammer);
    await expect(main.getByRole("heading", { name: awaitingCosign })).toBeVisible();
    await cosignTab.click();
    await expect(main.getByRole("heading", { name: "Арман Сатыбалдиев" })).toBeVisible();
    await expect(incoming.getByText("850 000 ₸", { exact: true })).toBeVisible();
    await incoming.getByRole("button", { name: "Software Key", exact: true }).click();
    await incoming.getByRole("button", { name: "Привязать устройство", exact: true }).click();
    await expect(main.getByText("Software #2", { exact: true })).toBeVisible();

    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    await incoming.getByRole("button", { name: "Отклонить — это мошенники!" }).click();
    await expect(main.getByRole("heading", { name: "Вторая рука остановила операцию" })).toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
    await expect(balanceAfterTransfer).toBeVisible();
    await expect(main.getByRole("heading", { name: "Защитный режим охлаждения" })).toBeVisible();
  });

  await test.step("SOC показывает минимум четыре отражённые атаки до сброса", async () => {
    await page.goto("/soc");
    const kpis = page.getByRole("region", { name: "Ключевые показатели SOC" });
    await expect(kpis.getByText("Атак отражено", { exact: true })).toBeVisible();
    const blocked = kpis.getByTestId("soc-attacks-blocked");
    await expect(blocked).toBeVisible();
    await expect.poll(async () => Number((await blocked.innerText()).replace(/\s/g, ""))).toBeGreaterThanOrEqual(4);
  });

  await test.step("После сброса режима охлаждения Арман подтверждает перевод на 850 000 ₸", async () => {
    // Rejecting on the Second Hand locks the account for 24 hours. Reset restores the seed balance.
    await resetDemo(page.request, baseURL, true);
    await page.goto("/");
    await expect(main.getByText("1 200 000 ₸", { exact: true })).toBeVisible();
    await signTransfer(page, toScammer);
    await expect(main.getByRole("heading", { name: awaitingCosign })).toBeVisible();
    await cosignTab.click();
    await incoming.getByRole("button", { name: /^Подписать \(Software Key #2/ }).click();
    await expect(main.getByRole("heading", { name: executed })).toBeVisible();
    await expect(main.getByText("350 000 ₸", { exact: true })).toBeVisible();
  });

  await test.step("Crypto Inspector показывает байты ECDSA P-256 и размер ML-DSA-65", async () => {
    await main.getByRole("button", { name: "Открыть Crypto Inspector", exact: true }).click();
    const inspector = page.getByRole("dialog", { name: "Crypto Inspector" });
    await expect(inspector.getByRole("heading", { name: "Подпись WebAuthn · ECDSA P-256" }).first()).toBeVisible();
    await expect(inspector.getByText(/^[1-9]\d* байт$/).first()).toBeVisible();
    await expect(inspector.getByText(/^Base64URL · [\w-]+$/).first()).toBeVisible();
    await expect(inspector.getByText("3 309 байт", { exact: true }).first()).toBeVisible();
    await inspector.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(inspector).toBeHidden();
  });

  await test.step("ROI показывает экономию на SMS и предотвращённые потери", async () => {
    await page.goto("/roi");
    const annualSavings = main.getByTestId("roi-annual-savings");
    await expect(annualSavings.getByText("2,268 млрд ₸", { exact: true })).toBeVisible();
    await expect(annualSavings.getByText("1,05 млрд ₸", { exact: true })).toBeVisible();
  });

  await test.step("В BCC Business директор получает запрос на 1 250 000 ₸", async () => {
    await page.getByRole("link", { name: "Демо-стенд", exact: true }).click();
    await page.getByRole("group", { name: "Режим демо" }).getByRole("button", { name: "BCC Business (МСБ)" }).click();
    await expect(main.getByRole("heading", { name: "ТОО «Алатау Логистик»" })).toBeVisible();
    await enrollSender(page);
    await signTransfer(page, "СнабТехСервис · 1 250 000 ₸");
    await expect(main.getByRole("heading", { name: awaitingCosign })).toBeVisible();
    await cosignTab.click();
    await expect(main.getByRole("heading", { name: "Тимур Бекмуратов" })).toBeVisible();
    const request = incoming.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Требуется подпись директора" }),
    });
    await expect(request.getByRole("heading", { name: "Требуется подпись директора" })).toBeVisible();
    await expect(request.getByText("1 250 000 ₸", { exact: true })).toBeVisible();
  });
});
