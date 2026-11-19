# Red Team аудит и оценка готовности BCC SafeSign (жюри: CISO банка и криптограф)

Область проверки: `src/**`, `tests/**`, соответствие `BCC_SafeSign_TZ.md` (§4, §5, §8, §10, §14) и верификация исправлений после `docs/AUDIT_CORE.md`.

> **Общий вердикт (TL;DR):** Криптографическое ядро (`src/lib/crypto/**`) и серверная проверка 6 атак ТЗ §8 реализованы **честно** — без заглушек и с реальной математической верификацией `@simplewebauthn/server` и `@noble/post-quantum` (`ml_dsa65`). Главные проблемы сосредоточены на **периметре API и UI-слое**: полное отсутствие аутентификации и CSRF-защиты на мутирующих эндпоинтах (`reset`, `cosign/reject`, `devices`, `prepare`), нефильтрованный SSE-поток, раскрывающий `txId` чужих транзакций (в сочетании с неаутентифицированным `cosign/reject` это даёт удалённую 24-часовую блокировку счёта), жёсткая привязка к `http://localhost:3000`, исчерпание лимита 6 HTTP/1.1 соединений при открытых вкладках и методически спорный подсчёт «Спасено средств» в SOC.

---

## (а) Честность демо и трассировка 6 атак ТЗ §8

### 1. Проверка на фейк, нарисованные тайминги и клиентские блокировки

- **Заглушек вида `if (attack) return blocked` нет.** Поле `attackTag` в `executeSchema` (`src/lib/tx/inputs.ts:48`) сохраняется только как метаданные аудита в `SecurityEvent.technicalDetails.attackTag` (`src/lib/tx/service.ts:247`). Ни `verifyPrimary` / `verifyHybrid` (`src/lib/crypto/hybrid-verifier.ts:64-158`), ни классификатор `attackType()` (`src/lib/soc/service.ts:5-19`) не принимают решений на основе `attackTag`.
- **Тайминги реальные.** Время шагов на сервере (`src/lib/crypto/hybrid-verifier.ts:42,53,68,149`) и подписи на клиенте (`src/lib/client/signer.ts:150,156,161,167,175,177`; `src/components/hacker/QuantumCompareModal.tsx:37,39`) измеряется через `performance.now()`.
- **Единственный «косметический» элемент таймингов в UI:**
  - В `src/components/soc/SocDashboard.tsx:463,467` до первой транзакции (`mlDsa.count === 0`) отображается ориентир `"< 5 мс"`, а ширина зелёной полосы сравнения зафиксирована как `w-[4%] min-w-[10px]` (против `"12–45 сек · 12 ₸ / оп"` для SMS-OTP в `SocDashboard.tsx:449`). После первого замера цифра заменяется на реальное среднее `formatMs(hybridTotalAvgMs)`.
  - В `src/components/bank/BiometricSignModal.tsx:65` добавлена задержка UI `320 мс` параллельно `api.execute()` ради завершения анимации двух замков; на записанные `clientTimings` и `verifyTimeMs` она не влияет.

### 2. Оценка `src/components/hacker/attacks.ts` и параметра `originOverride`

- **Влияние на продакшен-путь подписи (архитектурный риск, но не обход криптографии):**
  - `BiometricSignModal.tsx:10,60,66` напрямую импортирует `buildExecuteBody`, `rememberValidPacket` и `useAttackState` из `src/components/hacker/attacks.ts`. При включённом перехватчике нормальный экран подтверждения подменяет `submittedPayload` после подписи, а после каждого успешного подтверждения сохраняет полный подписанный запрос (`webAuthnAssertion`, `pqSignatureBase64`, `submittedPayload`) в модульном состоянии `state.lastValid` (`attacks.ts:25-26,52-55`).
  - `src/lib/client/signer.ts:135,138,152,188` и `src/lib/crypto/software-authenticator.ts:77` принимают `{ originOverride?: string }` в клиентском слое подписи (в `signCosign` на `signer.ts:198-211` этого параметра нет).
  - В промышленной сборке такой код должен быть изолирован в тестовом/демо-транспорте и исключён tree-shaking'ом в production build.
- **Можно ли через `originOverride` обойти защиту на реальном домене? Нет.**
  1. Для аппаратного `PLATFORM_PASSKEY` передача `originOverride` явно запрещена на клиенте (`signer.ts:158`), а сам браузер внутри `navigator.credentials.get()` привязывает `clientDataJSON.origin` к фактическому origin вкладки.
  2. Для `SOFTWARE_FALLBACK` параметр `originOverride` подставляет строку `"origin"` только в локальный JSON `clientDataJSON` (`software-authenticator.ts:83`).
  3. С фишингового сайта (`https://evil.example`) злоумышленник **не имеет доступа** к `IndexedDB` жертвы на `https://bcc.kz` (Same-Origin Policy), поэтому не владеет её ключами ECDSA и ML-DSA-65.
  4. Если же злоумышленник передаёт `originOverride` на чужой origin с собственного ключа, сервер на шаге 4 (`hybrid-verifier.ts:112`) проверяет `requestOrigin === expectedOrigin && data.origin === requestOrigin && data.crossOrigin !== true`, а `@simplewebauthn/server` (`webauthn.ts:79`) дополнительно сверяет `expectedOrigin` — запрос гарантированно падает с `403 ERR_ORIGIN_MISMATCH`.
  5. Подделать заголовок `Origin` из браузера на чужом сайте нельзя (запрещённый заголовок Fetch/XHR).

### 3. Фактический путь данных для всех 6 атак ТЗ §8

| № | Сценарий (ТЗ §8) | Путь данных от кнопки в UI | Где и как реально ломается |
|---|---|---|---|
| **1** | **MITM: подмена суммы (`15 000 → 500 000 ₸`)** | `AttackSimulatorPanel.tsx:66` (`armInterceptor("MITM_AMOUNT")`) → `BiometricSignModal.tsx:55` (`signPrimary` подписывает `15 000 ₸`) → `BiometricSignModal.tsx:60` (`buildExecuteBody` → `attacks.ts:19-23,44-49` меняет `submittedPayload.amountTenge = 500_000`, оставляя подписи от `15 000 ₸`) → `POST /api/transactions/execute` | **Сервер (`hybrid-verifier.ts:92-105,122-133`):** шаг 3 считает `SHA-256(canonical(submitted))` ≠ `record.txHashHex` → `tamperDiff`; затем шаги 5 и 6 проверяют присланные WebAuthn и ML-DSA-65 против *изменённого* `submittedHash` и оба математически отклоняют подписи → `403 ERR_WYSIWYS_TAMPERED`, списание не происходит, событие `ATTACK_MITM_BLOCKED` пишется в SOC. |
| **2** | **MITM: подмена IBAN получателя** | `AttackSimulatorPanel.tsx:69` (`armInterceptor("MITM_RECIPIENT")`) → `signPrimary` подписывает оригинал → `attacks.ts:15-16,22` меняет `recipientAccount = "KZ99856000000666DROP"`, `recipientName = "Дроппер Х"` → `POST /api/transactions/execute` | **Сервер (`hybrid-verifier.ts:92-105,122-133`):** шаг 3 выявляет расхождение хэша и diff по `recipientAccount`/`recipientName`, шаги 5 и 6 падают при проверке подписей против изменённого хэша → `403 ERR_WYSIWYS_TAMPERED`. |
| **3** | **Replay Attack (повтор пакета)** | После успешного `execute` `BiometricSignModal.tsx:66` сохраняет пакет (`attacks.ts:52-55`) → `AttackSimulatorPanel.tsx:74` (`replayLastPacket`, `attacks.ts:62-66`) шлёт точную копию в `POST /api/transactions/execute` | **Сервер (`hybrid-verifier.ts:73,84-88`, `store.ts:57-64`):** в рамках `SerializedAdapter.transact` шаг 1 видит `tx.nonceUsed === true`, возвращает `null`, шаг 2 отклоняет пакет с `403 ERR_REPLAY_DETECTED` и пишет `ATTACK_REPLAY_BLOCKED`. (Примечание: на TouchID `signCount` может оставаться `0`, поэтому защита держится именно на `nonceUsed`.) |
| **4** | **Фишинг-клон сайта (`bcc-bonus`)** | **Ветка А (браузер):** ссылка в `AttackSimulatorPanel.tsx:80-81` открывает `http://127.0.0.1:3000/phishing-clone` → кнопка «Получить бонус» (`OriginCheck.tsx:23-25`) вызывает `navigator.credentials.get({ rpId: "localhost" })`.<br>**Ветка Б (сервер):** кнопка «Подсунуть чужой Origin» (`AttackSimulatorPanel.tsx:82`, активна только для Software Key) → `submitFromForeignOrigin` (`attacks.ts:72-88`) → `prepare` → `signPrimary(..., { originOverride: "http://127.0.0.1:3000" })` → `POST /api/transactions/execute` | **Ветка А:** браузер по спецификации WebAuthn отвергает доступ к ключу `rpId="localhost"` со страницы `127.0.0.1` (`SecurityError`/`NotAllowedError`, без вызова API/SOC).<br>**Ветка Б:** ECDSA подпись в `software-authenticator.ts:83` честная, но содержит `clientDataJSON.origin = "http://127.0.0.1:3000"`. На сервере шаг 4 (`hybrid-verifier.ts:112`) сравнивает `data.origin === requestOrigin` (`expectedOrigin`), отклоняет с `403 ERR_ORIGIN_MISMATCH` и логирует `ATTACK_PHISHING_BLOCKED`. |
| **5** | **Соц. инженерия («Звонок из Нацбанка»)** | `AttackSimulatorPanel.tsx:87` → `TransferForm.tsx:17-20` заполняет `850 000 ₸` на `KZ99...DROP` с `activeUnknownCall: true` → клиент сам подписывает → `POST /api/transactions/execute` → `202 PENDING_COSIGN` → SSE/опрос на `/cosign` и во вкладке «Вторая рука» → кнопка «Отклонить — это мошенники!» (`CosignFeed.tsx:123`) → `POST /api/transactions/cosign/reject` | **Risk Engine + Co-Sign (`risk/engine.ts:20-43`, `tx/service.ts:220-234,286-303`):** `riskScore = 100 (HIGH)` переводит операцию в `PENDING_COSIGN` без списания. `cosignReject` переводит в `BLOCKED_BY_COSIGNER`, активирует 24-часовой `coolingOffUntil` и публикует `SOCENG_STOPPED_BY_COSIGNER`. |
| **6** | **Квантовая атака будущего (Шор)** | `QuantumCompareModal.tsx:28-47` → `api.prepare` (`amountTenge: 1`) → `signPrimary` (получает реальный WebAuthn assertion, но выбрасывает реальную PQ-подпись) → `keygen()` создаёт одноразовый ключ ML-DSA-65 и подписывает им `txHash` → `POST /api/transactions/execute` с `quantumSimulation: true` | **Сервер (`hybrid-verifier.ts:122-138`):** при `simulation: true` шаг 5 помечается `COMPROMISED` (не останавливает поток), а шаг 6 вызывает **настоящую** `ml_dsa65.verify(signature, message, device.pqPublicKey)` (`mldsa.ts:42-45`). Подпись одноразового ключа математически не проходит → `403 ERR_PQ_SIGNATURE_INVALID` (`PQ_SIGNATURE_REJECTED`). Если же передать валидную PQ-подпись, шаг 7 (`hybrid-verifier.ts:138`) режет исполнение через `403 ERR_SIMULATION_ONLY`. |

---

## (б) Новые уязвимости после аудита (API, SSE, UI и хранилище)

### CRITICAL

#### [RT-01] Полное отсутствие аутентификации и сессионной авторизации на всех эндпоинтах HTTP API (IDOR / Broken Access Control)
- **Местоположение:** все роуты в `src/app/api/**` (`src/app/api/devices/route.ts:6-7`, `src/app/api/transactions/route.ts:6-10`, `src/app/api/transactions/[id]/route.ts:6-11`, `src/app/api/transactions/prepare/route.ts:4-9`, `src/app/api/transactions/cosign/prepare/route.ts:4`, `src/app/api/transactions/cosign/reject/route.ts:4-9`, `src/app/api/users/route.ts:4`, `src/app/api/soc/events/route.ts:4`, `src/app/api/demo/reset/route.ts:5-8`).
- **Суть уязвимости:** Сервер не проверяет сессию/токен вызывающего и безоговорочно доверяет `senderId`, `userId`, `cosignerUserId` и `id` из тела/query запроса.
  - Любой клиент может получить балансы, IBAN, историю транзакций с полными `SignatureBundle` и события SOC всех пользователей.
  - Любой клиент может перечислить `deviceId` через `GET /api/devices?userId=usr_aigul` и удалить чужой ключ через `DELETE /api/devices?id=...`, полностью заблокировав жертве доступ к подписанию.
  - Любой клиент может создавать неограниченное число транзакций `prepare` (засоряя `store.json` и расходуя память).
- **Фикс:** Ввести серверную сессию (`HttpOnly; SameSite=Lax; Secure` cookie, привязанную к аутентифицированному `userId` через WebAuthn login или demo-session selector в MVP), выводить `senderId`/`cosignerUserId`/`userId` исключительно из сессии и запрещать доступ к чужим `txId`, устройствам и журналам.

---

### HIGH

#### [RT-02] Межсайтовый CSRF на `POST /api/demo/reset`, `POST /api/transactions/cosign/reject`, `POST /api/transactions/prepare` через «простой» CORS-запрос (`text/plain`)
- **Местоположение:** `src/lib/api/http.ts:35-42` (`post()`), `src/app/api/demo/reset/route.ts:5-8`, `src/app/api/transactions/cosign/reject/route.ts:4-9`, `src/app/api/transactions/prepare/route.ts:4-9`, `src/app/api/transactions/cosign/prepare/route.ts:4`, `src/app/api/auth/register/options/route.ts:4`.
- **Суть уязвимости:** Хелпер `post()` вызывает `await request.json()` без проверки заголовка `Content-Type: application/json`, без проверки `Origin` / `Sec-Fetch-Site` и без CSRF-токена (в отличие от `finishRegistration` в `devices/service.ts:43` и `execute`/`cosignSubmit` в `hybrid-verifier.ts:112`). Любой сторонний сайт в браузере пользователя может отправить `fetch("http://localhost:3000/api/demo/reset", { method: "POST", body: '{"keepDevices":false}' })` с дефолтным `Content-Type: text/plain;charset=UTF-8` (CORS simple request, без preflight `OPTIONS`!), мгновенно уничтожив все транзакции, события SOC и серверные ключи. Аналогично злоумышленник может по CSRF вызвать `cosign/reject` (при знании `txId`) и заблокировать счёт на 24 часа.
- **Фикс:** В `post()` (`src/lib/api/http.ts`) строго проверять `Content-Type === "application/json"`, сверять `Origin === relyingParty().expectedOrigin` (и `Sec-Fetch-Site: same-origin` при наличии) на всех мутирующих роутах, а для сессионных мутаций добавить CSRF-токен / `SameSite=Strict`.

#### [RT-03] SSE без фильтра и без авторизации раскрывает чужие транзакции, `txId` и технические детали атак
- **Местоположение:** `src/lib/events/bus.ts:42-49` (`matches()`), `src/app/api/events/stream/route.ts:7`, `src/app/api/events/poll/route.ts:5`, а также клиентские вызовы без фильтра: `src/components/bank/DemoStand.tsx:62,174`, `src/components/shell/Topbar.tsx:158`, `src/lib/client/useDemoState.ts:8`, `src/components/crypto/useTransaction.ts:10`.
- **Суть уязвимости:**
  1. В `bus.ts:44` фильтр `userId` применяется только если `userId` передан (`if (userId && ...)`). При подписке без параметров (`GET /api/events/stream` и `GET /api/events/poll`) поток транслирует события **всех участников** (`usr_aigul`, `usr_dinara`, `usr_arman`, `usr_timur`): `COSIGN_REQUESTED`, `TX_UPDATED`, `SECURITY_ALERT` (включая `actorName`, `amountTenge`, `txId`, `tamperDiff`, `verificationTrace`, `coolingOffUntil`).
  2. На клиенте `DemoStand`, `Topbar`, `useDemoState` и `useTransaction` вызывают `useEventStream()` **без `userId` и `channel`**, из-за чего клиент B2C получает события операций B2B (и наоборот).
  3. Секретные ключи (`pqSecretKey`, ECDSA `privateKey`) в SSE и логах **не утекают** (проверено по `SignatureBundle`, `SecurityEvent`, `RegisteredDevice`), однако утечка `txId` и `cosignerUserId` из `COSIGN_REQUESTED` в связке с уязвимостью `AUDIT-08` (`cosign/reject` без авторизации, `tx/service.ts:286-303`) позволяет любому наблюдателю SSE немедленно заблокировать любую проходящую Co-Sign-операцию и заморозить счёт инициатора на 24 часа.
- **Фикс:** Сделать `userId` (из аутентифицированной сессии) обязательным для пользовательских каналов SSE/poll, отделить канал `soc` под роль администратора ИБ, а в `DemoStand` / `Topbar` / `useTransaction` подписываться с явным `userId`.

#### [RT-04] Возможность извлечения открытого приватного ключа ML-DSA-65 из IndexedDB при любом XSS и отсутствие CSP
- **Местоположение:** `src/lib/crypto/client-keystore.ts:77-85,188-191` (`prepareKeystore`, `readPqSecretKey`), `src/lib/client/signer.ts:86` (`registerSoftware(..., { extractable: true })`), отсутствие `next.config.*` / `middleware.ts`.
- **Суть уязвимости:**
  1. Хотя ключ шифрования `AES-GCM-256` создаётся с `extractable: false` (`client-keystore.ts:83`), он хранится в IndexedDB (`"keys"` → `"aes-gcm"`), а его операция `decrypt` доступна любому JS-коду в том же origin. Поскольку `@noble/post-quantum` работает в JS, `readPqSecretKey()` (`client-keystore.ts:188-191`) расшифровывает **сырой 4032-байтный приватный ключ `pqSecretKey`** в `Uint8Array`. Любой XSS или скомпрометированная зависимость/расширение может открыть `bcc-safesign-keystore` и похитить `pqSecretKey` навсегда.
  2. В `Software Fallback` при регистрации (`signer.ts:86`) ECDSA-ключ создаётся с `extractable: true`, чтобы `saveLocalDevice` (`client-keystore.ts:141`) смог экспортировать `pkcs8` в память перед шифрованием (в `finally` байты зануляются; при последующем чтении импортируется с `extractable: false`).
  3. В проекте отсутствуют HTTP-заголовки `Content-Security-Policy` (нет `next.config.*` и `middleware.ts`).
- **Фикс:** Для MVP добавить строгий `Content-Security-Policy` (`default-src 'self'`, `script-src 'self'`, запрет `unsafe-eval`, `object-src 'none'`), Subresource Integrity; для Production — перенос генерации и хранения PQ-ключа в аппаратный TEE / Secure Enclave / Android StrongBox (ТЗ §4.2, §11).

#### [RT-05] Отсутствие защиты от Clickjacking (`X-Frame-Options` / `CSP frame-ancestors`)
- **Местоположение:** отсутствие `next.config.*` и `middleware.ts`, `src/app/cosign/page.tsx`, `src/components/cosign/CosignFeed.tsx:123`.
- **Суть уязвимости:** Ни одна страница не отдаёт `X-Frame-Options: DENY` или `Content-Security-Policy: frame-ancestors 'none'`. При том что кнопка «Отклонить — это мошенники!» (`cosignReject`) не требует WebAuthn/биометрии, сторонний сайт может встроить `/cosign` в прозрачный `<iframe>` и обманом заставить пользователя нажать отмену транзакции, активировав 24-часовой `coolingOffUntil`.
- **Фикс:** Добавить `X-Frame-Options: DENY` и `Content-Security-Policy: frame-ancestors 'none'` через `next.config.ts` / `middleware.ts`.

---

### MEDIUM

#### [RT-06] Неполный фикс `AUDIT-06`: Bidi/управляющие символы допускаются в `recipientAccount`, `deviceName` и `submittedPayload`
- **Местоположение:** `src/lib/tx/inputs.ts:13,38-44` (`prepareSchema.recipientAccount`, `submittedPayload`), `src/lib/devices/service.ts:10` (`registration.deviceName`), `src/components/ui/JsonDiffViewer.tsx:59`.
- **Суть уязвимости:** Проверка `displayText` (фильтр `[\p{Cc}\p{Cf}...]`, запрещающий `U+202E` RLO, `U+200B`, переводы строк) применена только к `recipientName` и `purpose` в `prepareSchema`, но **отсутствует** у `recipientAccount` (`inputs.ts:13` — `text`) и `deviceName` (`devices/service.ts:10`). Подмена счёта с Bidi-переопределением визуально искажает IBAN на экране WYSIWYS (`BiometricSignModal.tsx:77`, `CosignRequestCard.tsx:82`). Кроме того, `submittedPayload` (`inputs.ts:38-44`) принимает Bidi/управляющие символы в `recipientName`/`purpose`, которые сохраняются в `tx.tamperDiff` и `SecurityEvent.technicalDetails.tamperDiff` и отображаются оператору SOC (`JsonDiffViewer.tsx:59`).
  - *(Проверка XSS: классический DOM XSS через `<script>` / `<img onerror>` в `recipientName` и `purpose` отсутствует — `grep` по `src/` не выявил `dangerouslySetInnerHTML`, `innerHTML`, `eval` или `javascript:`-ссылок; React экранирует все текстовые узлы. Риск остаётся лишь при экспорте JSON-отчёта из `SocEventDetailDrawer.tsx:170` во внешние неэкранируемые HTML/CSV инструменты.)*
- **Фикс:** Применить `displayText` к `recipientAccount` (плюс валидация IBAN/алфанумерика) и `deviceName`; санитизировать/экранировать управляющие и bidi-символы при формировании `tamperDiff` для UI.

#### [RT-07] Завышенный и непоследовательный расчёт метрики SOC «Спасено средств» (`savedAmountTenge`)
- **Местоположение:** `src/lib/soc/service.ts:30-48`, `src/lib/tx/service.ts:42`, `src/components/bank/DemoStand.tsx:131-134`, `src/components/soc/SocDashboard.tsx:334-357`.
- **Суть проблемы:**
  1. `savedByTransaction` в `soc/service.ts:38` дедуплицирует сумму **только по `txId`**. Поскольку в Панели хакера каждая кнопка/попытка («MITM сумма», «MITM IBAN», «Чужой Origin») запускает новый `prepare()` с новым `txId`, прогон MITM-суммы + MITM-IBAN + Replay + Origin на базовой операции `15 000 ₸` даёт `15 000 × 4 = 60 000 ₸` «спасённых средств» при переводе всего в `15 000 ₸` (подтверждено в `tests/api.test.ts:109`).
  2. При MITM-подмене суммы (`15 000 → 500 000 ₸`) `audit()` (`tx/service.ts:42`) записывает в `event.amountTenge` исходную сумму `tx.payload.amountTenge` (`15 000 ₸`), а не сумму, которую пытался похитить атакующий (`500 000 ₸`, или риск-дельту `485 000 ₸`).
  3. Диагностическая проверка в `QuantumCompareModal` (`DemoStand.tsx:131`, `amountTenge: 1`) при падении на шаге 6 генерирует `PQ_SIGNATURE_REJECTED` и добавляет **`+1 ₸`** к KPI «Спасено средств» (итого `60 001 ₸` / `850 001 ₸`).
- **Что честнее показывать жюри:**
  - Разделить KPI на два показателя: (1) **«Спасено от фрода (подтверждено)»** — сумма операций, остановленных через Co-Sign (`SOCENG_STOPPED_BY_COSIGNER`, например `850 000 ₸`) и повторных списаний (`ATTACK_REPLAY_BLOCKED`, сумма предотвращённого дубля, один раз на `txId`); (2) **«Сумма под угрозой в отражённых технических атаках»** — для MITM учитывать `max(originalAmount, tamperedAmount)` или дельту, для фишинга — сумму предотвращённого перевода, и **исключить** диагностические пробы (`quantumSimulation` / `1 ₸`) из денежного KPI.

#### [RT-08] Политики шага 7 исполняются внутри шага 1, маскируя подмену и ломая семантику трассы
- **Местоположение:** `src/lib/crypto/hybrid-verifier.ts:80` (`context.preparePolicy(tx)` внутри `trace.check(1, ...)`), `src/lib/tx/service.ts:214-243`.
- **Суть проблемы:** После фикса `AUDIT-02` вызов `preparePolicy(tx)` перенесён в шаг 1 (`TX_EXISTENCE_AND_TTL`). В результате отказ по `ERR_ACK_REQUIRED`, `ERR_COOLING_OFF` или `ERR_INSUFFICIENT_FUNDS` помечает как `FAIL` **шаг 1**, а шаги 2–7 остаются `SKIPPED` (хотя шаг 7 официально называется `RISK_AND_POLICY_GATE`). Кроме того, пакет с `acknowledgedWarning: false` и подменённой суммой (`500 000 ₸`) для `MEDIUM`-операции упадёт на шаге 1 с `409 ERR_ACK_REQUIRED` до проверки WYSIWYS и подписей.
- **Фикс:** Вынести пред-криптографические проверки владения устройством и не-криптографические пред-проверки (без записи в шаг 1) либо возвращать структурированный `409` до трассы верификации, оставляя 7-шаговую трассу исключительно для криптографического протокола (где шаг 7 действительно отражает политику после валидных подписей, без сжигания `nonce` при `409`).

#### [RT-09] Зависание `heartbeat`-таймера при аварийном разрыве SSE и потеря событий между воркерами
- **Местоположение:** `src/lib/events/stream.ts:14`, `src/lib/events/bus.ts:12-17`.
- **Суть проблемы:** В `streamEvents` (`stream.ts:14`) `setInterval(() => controller.enqueue(...), 15_000)` не обёрнут в `try/catch` и не вызывает `cancel()` при ошибке записи в уже закрытый контроллер. Если TCP-соединение закроется до срабатывания `signal.abort`, таймер выбросит неперехваченный `TypeError` внутри `setInterval`. Дополнительно `safeSignListeners`/`safeSignJournal` находятся в памяти одного процесса Node.js, поэтому при нескольких воркерах или serverless-деплое события не доходят до подписчиков другого инстанса.
- **Фикс:** Обернуть `enqueue` в `heartbeat` и `send` в `try/catch` с вызовом `cancel()`; для multi-instance заменить шину на Redis Pub/Sub / Streams.

#### [RT-10] `POST /api/transactions/prepare` без проверки `Origin` допускает кросс-сайтовый спам `CHALLENGE_ISSUED` и раздувание БД
- **Местоположение:** `src/app/api/transactions/prepare/route.ts:4-9`, `src/lib/tx/service.ts:172-202`.
- **Суть проблемы:** Без сессии, rate limit и проверки `Origin` сторонний ресурс или скрипт может бесконечно вызывать `prepare`, заполняя `db.transactions` (`store.json`) и генерируя поток SSE `TX_UPDATED` (вплоть до переполнения журнала в `bus.ts:32` на 512 записей и вытеснения реальных событий).
- **Фикс:** Ограничить `prepare` авторизованной сессией, проверкой `Origin` и периодической очисткой/ограничением активных `CHALLENGE_ISSUED` на пользователя.

---

## (в) Хрупкость на демо (что может сломаться на сцене)

1. **[CRITICAL для сцены] Исчерпание лимита 6 HTTP/1.1-соединений браузера через множественные SSE-потоки (`useEventStream.ts:95,187-200`, `Topbar.tsx:158`, `useCosignFeed.ts:62`, `SocDashboard.tsx:78`).**
   - `<Topbar />` в `layout.tsx:18` открывает базовый `EventSource` (`/api/events/stream`) на **каждой** странице.
   - На `/cosign` (и при открытии вкладки «Вторая рука» на `/`) открывается **второй** `EventSource` (`?userId=...&channel=cosign`), на `/soc` — **второй** (`?channel=soc`).
   - Если спикер откроет 3 вкладки (`/`, `/cosign`, `/soc`) в одном браузере на `http://localhost:3000` (HTTP/1.1), откроется **5–6 постоянных SSE-соединений**. При лимите Chromium/Safari в 6 соединений на origin новые `fetch`-запросы (`/api/transactions/execute`, `/api/users`, `/api/soc/events`) или открытие 4-й вкладки (`/roi`) начнут зависать и падать по 5-секундному таймауту `handshake` (`useEventStream.ts:101`).
   - **Фикс:** Использовать единый `BroadcastChannel` / `SharedWorker` для одного SSE-подключения на браузер или единый `EventSource` на вкладку без дублирования в `Topbar` + странице.
2. **Двойной клик (Race Condition) в кнопках подготовки, регистрации, сброса и квантового теста (`DemoStand.tsx:102-113`, `DeviceOnboarding.tsx:13-22`, `Topbar.tsx:44-69,102-123`, `QuantumCompareModal.tsx:21-26`).**
   - В отличие от `BiometricSignModal` (`submitting = useRef`) и `CosignFeed` (`actionGuard = useRef`), перечисленные методы проверяют только React-state `busy`, который обновляется асинхронно. Двойной клик за `< 16 мс` вызывает два `prepare` (оставляя «висячую» транзакцию) или два параллельных системных диалога TouchID (второй падает с `NotAllowedError`).
   - **Фикс:** Добавить синхронные `useRef`-блокировки во все асинхронные обработчики кнопок.
3. **Потеря состояния при перезагрузке страницы (`F5`) или переключении вкладок во время Co-Sign (`DemoStand.tsx:53-57`, `attacks.ts:26`, `DemoStand.tsx:77,177`).**
   - При перезагрузке `/` (или переходе `/ → /soc → /`) React-состояния `attempt` и `prepared` исчезают: левый экран телефона больше не показывает статус ожидающей `PENDING_COSIGN`-транзакции (`DemoStand` не подтягивает активную транзакцию из `GET /api/transactions?userId=...`), а `attacks.ts` теряет `lastValid` (кнопка Replay блокируется).
   - Обратная ошибка при `?txId=...` в URL: `inspect()` записывает `?txId=...` в URL (`DemoStand.tsx:124`). При нажатии «Сбросить демо» `DemoSession` перемонтируется (`DemoStand.tsx:184`), но `useEffect` (`DemoStand.tsx:77`) снова считывает старый `txId` из адресной строки и открывает `CryptoInspectorDrawer` с красной ошибкой `404 ERR_TX_NOT_FOUND`.
   - **Фикс:** Восстанавливать последнюю активную `PENDING_COSIGN` транзакцию через `GET /api/transactions` при загрузке `DemoStand`, а при `DEMO_RESET` очищать параметр `?txId` из URL.
4. **Жёсткая привязка к `http://localhost:3000` ломает любой другой порт, `127.0.0.1`, LAN-IP (второй телефон по QR) и Vercel без ручных env (`webauthn.ts:11-17`, `devices/service.ts:43`, `OriginCheck.tsx:13`, `CosignEmbedSlot.tsx:20`).**
   - `relyingParty()` без переменных `SAFESIGN_RP_ID` и `SAFESIGN_ORIGIN` жёстко ожидает `localhost` и `http://localhost:3000`. Запуск на `:3001`, открытие на `http://127.0.0.1:3000` или сканирование QR-кода (`CosignEmbedSlot.tsx:20`) со второго телефона через LAN-IP приводит к `403 ERR_ORIGIN_MISMATCH` при регистрации и подписи (а по `http://<LAN-IP>` ещё и блокируется `window.isSecureContext` в `client-keystore.ts:78`).
   - В `OriginCheck.tsx:13` URL клона захардкожен как `http://127.0.0.1...`, что не работает на облачном HTTPS-деплое.
   - **Фикс:** Предусмотреть явный баннер предупреждения в Topbar при несовпадении `window.location.origin` с `expectedOrigin`, а на демо запускать строго на `http://localhost:3000` (или HTTPS-туннеле с настроенными `SAFESIGN_RP_ID`/`SAFESIGN_ORIGIN`).
5. **Истечение TTL, если долго говорить на сцене (`PRIMARY_TTL` 5 мин, `COSIGN_TTL` 15 мин, регистрация 60 с).**
   - В `BiometricSignModal.tsx:83-84` при истечении 5-минутного таймера кнопка «Подтвердить» блокируется, но внутри модалки нет кнопки «Обновить вызов» — нужно закрыть окно и снова нажать «Подписать без SMS». При нажатии на последней секунде (пока идёт TouchID) сервер вернёт `409 ERR_TX_EXPIRED`.
   - В `devices/service.ts:36` `challenge` регистрации живёт 60 секунд (`options.timeout ?? 60_000`) — долгая пауза с открытым окном TouchID провалит привязку (`ERR_WEBAUTHN_INVALID`).
   - На `/cosign` (`CosignFeed.tsx:240-242`) после истечения `COSIGN_TTL` (15 мин) карточка `ErrorCard` для `latest?.failureCode` остаётся висеть на пустом экране постоянно, даже после перезагрузки страницы.
   - **Фикс:** Добавить кнопку «Подготовить новый вызов» в `BiometricSignModal` при `remaining === 0` и не показывать терминальный `ERR_TX_EXPIRED` как глобальный `ErrorCard` вместо EmptyState на `/cosign`.
6. **Отсутствие TouchID, тихий fallback при отмене и блокировка кнопки фишинга при Passkey (`signer.ts:32-34,76-81`, `AttackSimulatorPanel.tsx:82`).**
   - В `signer.ts:33,77` отмена диалога TouchID (`NotAllowedError`) во время регистрации **тихо** переводит пользователя на `SOFTWARE_FALLBACK` вместо сообщения об отмене.
   - Если же для основного стенда зарегистрирован настоящий `PLATFORM_PASSKEY` (TouchID), кнопка «Подсунуть чужой Origin» в Панели хакера **отключена** (`AttackSimulatorPanel.tsx:82`: `disabled={!softwareKey}`), и продемонстрировать серверный блок `403 ERR_ORIGIN_MISMATCH` с этого же устройства без перепривязки Software Key не получится.
   - **Фикс:** Разрешить для кнопки «Подсунуть чужой Origin» временную эмуляцию Software Key на стороне атаки либо явно подсказать в UI; различать отмену пользователем и отсутствие аппаратного сканера.
7. **24-часовая заморозка (`coolingOffUntil`) и десинхронизация IndexedDB при сбросе (`CosignFeed.tsx:123`, `Topbar.tsx:55,160`).**
   - Если на сцене случайно нажать «Отклонить — это мошенники!» раньше времени, клиент `usr_aigul` блокируется на 24 часа (`ERR_COOLING_OFF`) до нажатия «Сбросить демо».
   - При сбросе со снятой галочкой «Сохранить мои Passkeys» (`keepDevices: false`) `clearLocalDevices()` (`Topbar.tsx:55`) очищает IndexedDB только в той вкладке, где нажата кнопка; на втором телефоне (`/cosign`) в IndexedDB остаются «осиротевшие» зашифрованные записи. Кроме того, в `Topbar.tsx:160` используется `lastEvent?.type === "DEMO_RESET"` (вместо `events.findLast` как в `DemoStand.tsx:175`), поэтому быстрое следующее событие может скрыть признак сброса.
   - **Фикс:** При получении `DEMO_RESET { keepDevices: false }` по SSE автоматически очищать устаревшие записи из локального IndexedDB и использовать `events.findLast`.
8. **Safari и приватный режим / блокировка IndexedDB (`client-keystore.ts:33-36,78`).**
   - В Safari при обращении по `http://127.0.0.1` или LAN-IP возможны ограничения `isSecureContext` / WebAuthn; в `openDatabase()` (`client-keystore.ts:33-36`) событие `onblocked` немедленно отклоняет работу с keystore; в Safari без TouchID поведение WebAuthn зависит от iCloud Keychain / диалога QR.

---

## (г) Соответствие чек-листу ТЗ §14.1

| № | Критерий приёмки ТЗ §14.1 | Статус | Доказательства (`файл:строка`) и замечания |
|---|---|---|---|
| 1 | Устройство регистрируется через настоящий WebAuthn (TouchID/FaceID/Passkey) + создаётся пара `ML-DSA-65`. | **✅** | `src/lib/client/signer.ts:72-103` (`startRegistration`, `keygen`), `src/lib/crypto/webauthn.ts:24-66` (`verifyRegistrationResponse`, PoP ML-DSA-65, проверка $t_1 \ne 0$), `src/lib/devices/service.ts:28-74`. Есть честный `SOFTWARE_FALLBACK` (`signer.ts:83-92`). |
| 2 | Обычный перевод доверенному контакту (`15 000 ₸`) проходит за `< 1 сек` без SMS, баланс обновляется, в Crypto Inspector видны обе реальные подписи и время проверки. | **✅** | `src/lib/tx/service.ts:172-269`, `src/lib/crypto/hybrid-verifier.ts:64-158`, `src/components/bank/BiometricSignModal.tsx:49-74`, `src/components/crypto/CryptoInspectorDrawer.tsx:12-37,56-77`. (Отклонение по ТЗ §6.2: стартовый баланс `1 200 000 ₸` в `src/lib/db/seed.ts:18`, согласовано в `AUDIT-12`.) |
| 3 | MITM-подмена суммы (`15 000 ₸ → 500 000 ₸`) реально возвращает `403 ERR_WYSIWYS_TAMPERED` с подсветкой подменённого поля. | **✅** | `src/components/hacker/attacks.ts:14,19-23,44-49`, `src/components/bank/BiometricSignModal.tsx:60`, `src/lib/crypto/hybrid-verifier.ts:92-105,133`, `src/lib/api/http.ts:8`, `src/components/hacker/AttackBlockedShield.tsx:25-29`, `src/components/ui/JsonDiffViewer.tsx:50-64`. Тест: `tests/hacker-panel.test.ts:77-91`. |
| 4 | MITM-подмена IBAN реально возвращает `403 ERR_WYSIWYS_TAMPERED`. | **✅** | `src/components/hacker/attacks.ts:15-23,44-49`, `src/lib/crypto/hybrid-verifier.ts:92-105,133`, `src/lib/api/http.ts:8`. Тест: `tests/hacker-panel.test.ts:93-104`. |
| 5 | Replay Attack на валидную транзакцию реально возвращает `403 ERR_REPLAY_DETECTED`. | **✅** *(⚠️ multi-worker)* | `src/components/hacker/attacks.ts:52-66`, `src/lib/crypto/hybrid-verifier.ts:73,84-88`, `src/lib/db/store.ts:57-64`, `src/lib/api/http.ts:8`. Тест: `tests/hacker-panel.test.ts:106-118`. В одном процессе атомарно; между воркерами не защищено (`AUDIT-03`, `tests/audit.test.ts:357`). |
| 6 | На фишинговом клоне (другой origin) браузер реально блокирует Passkey / сервер возвращает `403 ERR_ORIGIN_MISMATCH`. | **⚠️** | `src/app/phishing-clone/OriginCheck.tsx:23-31` (браузер блокирует без отправки в SOC), `src/components/hacker/attacks.ts:72-88`, `src/components/hacker/AttackSimulatorPanel.tsx:82`, `src/lib/crypto/hybrid-verifier.ts:108-120`. Оговорка: кнопка «Подсунуть чужой Origin» неактивна при `PLATFORM_PASSKEY`; привязка к `localhost:3000` и `http://127.0.0.1` хрупка на нестандартных портах и Vercel. |
| 7 | Перевод `850 000 ₸` незнакомцу с флагом звонка замораживается в `PENDING_COSIGN` и мгновенно приходит на экран «Второй руки», где его можно заблокировать или подписать второй криптоподписью. | **⚠️** | `src/lib/risk/engine.ts:20-43`, `src/lib/tx/service.ts:220-234,261-263,271-303`, `src/components/cosign/useCosignFeed.ts:62-97`, `src/components/cosign/CosignFeed.tsx:113-165`. Оговорка: `cosign/reject` без аутентификации/CSRF + `txId` утекает в нефильтрованный SSE (`RT-02`, `RT-03`), а перезагрузка `/` теряет карточку ожидания на левом телефоне (`DemoStand.tsx:57`). |
| 8 | Переключатель `bcc.kz` ↔ `BCC Business` меняет роли и правила скоринга. | **✅** | `src/components/shell/Topbar.tsx:20-23,194`, `src/components/shell/DemoModeProvider.tsx:65-80`, `src/lib/demo/participants.ts:3-6`, `src/lib/risk/engine.ts:25-29`, `src/components/bank/TransferForm.tsx:27-29,66-74`. |
| 9 | ROI-калькулятор корректно пересчитывает годовую экономию БЦК на SMS. | **✅** | `src/lib/roi/calc.ts:136-187` (`2 268 000 000 ₸/год` на SMS и `1 050 000 000 ₸/год` антифрод по умолчанию), `src/components/roi/SmsRoiCalculator.tsx:34-462`. Тест: `tests/roi.test.ts:12-142`. |
| 10 | Все автотесты `vitest` зелёные, кнопка `Reset Demo` чисто сбрасывает стенд за 1 клик. | **⚠️** | `npx vitest run`: 9 файлов, 122 passed, 1 expected fail (`tests/audit.test.ts:357`). Сброс: `src/components/shell/Topbar.tsx:32-86,221`, `src/app/api/demo/reset/route.ts:5-8`, `src/lib/db/store.ts:78-85`. Замечания: сброс требует подтверждения в модалке (2 клика), не чистит `IndexedDB` на других вкладках/телефоне, оставляет `?txId=` с ошибкой `404` в `DemoStand.tsx:77`, и открыт для CSRF (`RT-02`). |

---

## Сводка приоритетных исправлений

| ID | Серьёзность | Краткое описание | Приоритетный фикс |
|---|---|---|---|
| **RT-01** | **CRITICAL** | Отсутствие аутентификации и сессий на всех API | Ввести `HttpOnly; SameSite=Lax` сессию, брать `senderId`/`cosignerUserId` из сессии, закрыть IDOR |
| **RT-02** | **HIGH** | CSRF (`text/plain`) на `reset`, `cosign/reject`, `prepare` | Проверять `Content-Type: application/json`, `Origin` и CSRF-токен в `post()` (`src/lib/api/http.ts`) |
| **RT-03** | **HIGH** | SSE/poll без фильтра и авторизации выдаёт чужие `txId` | Обязательный `userId` из сессии в `/api/events/{stream,poll}`; передавать `userId` во всех `useEventStream()` |
| **RT-04** | **HIGH** | XSS/JS в origin может расшифровать `pqSecretKey` из IDB; нет CSP | Добавить строгий `CSP` без `unsafe-eval`; в production — аппаратный Keystore/TEE |
| **RT-05** | **HIGH** | Нет `X-Frame-Options` / `frame-ancestors` (Clickjacking `/cosign`) | Задать `X-Frame-Options: DENY` и `CSP frame-ancestors 'none'` |
| **RT-06** | **MEDIUM** | Bidi/control-символы в `recipientAccount`, `deviceName`, `tamperDiff` | Распространить `displayText` на `recipientAccount` и `deviceName`; санитизировать `tamperDiff` |
| **RT-07** | **MEDIUM** | SOC «Спасено средств» складывает `15k` на каждый новый `txId` и `+1 ₸` от квантовой пробы | Разделить реальный спасённый фрод (Co-Sign/Replay) и атакованный объём MITM/Origin; исключить `1 ₸` симуляцию |
| **RT-08** | **MEDIUM** | `preparePolicy` в шаге 1 маскирует трассу шагов 2–7 и подмену | Вынести пред-проверки владения без пометки шага 1, шаг 7 оставить для политик после подписей |
| **RT-09** | **MEDIUM** | `heartbeat` без `try/catch` в `stream.ts` + in-memory `bus.ts` | Добавить `try/catch` с `cancel()` в `stream.ts:14`; для кластера — Redis |
| **RT-10** | **MEDIUM** | Нет `Origin`/rate-limit на `prepare` (флуд `store.json` и SSE) | Добавить проверку `Origin`, авторизацию и лимит активных `CHALLENGE_ISSUED` |
| **DEMO-01** | **HIGH (сцена)** | 5–6 постоянных SSE-соединений исчерпывают пул HTTP/1.1 | Объединить SSE через `BroadcastChannel`/`SharedWorker` (1 поток на браузер) |
| **DEMO-02** | **MEDIUM (сцена)** | Двойные клики без `useRef`, потеря `PENDING_COSIGN` при F5, `?txId=` 404 после reset | Добавить `useRef`-гарды, восстановление активной TX на `/`, очистку `?txId` при reset, кнопку обновления истёкшего вызова |

## Статус исправлений

| Находка | Решение и способ проверки |
|---|---|
| RT-01 | **Accepted (demo): в Production — сессия bcc.kz/OAuth и привязка userId к сессии**. Переключатель персонажей входит в сценарий стенда. Проверка производственного требования в `tests/redteam.test.ts` остаётся `it.fails`. |
| DEMO-01, RT-03 | Оболочка вкладки владеет одним `EventSource` и одним резервным циклом опроса. Подписчики получают отфильтрованные события локально. При смене персонажа или страницы старый транспорт закрывается перед открытием нового. Стенд подписывается как отправитель, кабинет второй подписи — как выбранный согласующий. Обе стороны видят обновления общей операции. Без фильтра сервер передаёт только сброс демо. Для `channel=cosign` обязателен `userId` назначенного согласующего, и SSE, и poll проверяют его одинаково. |
| RT-03b | **Исправлена утечка через пользовательский поток.** Тест проверяет отсутствие чужого запроса в ленте и отказ с `ERR_COSIGNER` для чужого участника. SOC демо-банка публичен по замыслу и показывает события всех персонажей. Подтверждение личности предъявителя `userId` относится к принятому ограничению RT-01. |
| RT-02, RT-10 | Все POST и DELETE проверяют источник до выполнения операции. Чужой Origin получает `403 ERR_CSRF`. Для разрешённого источника любой тип тела, кроме `application/json`, получает 415. Без Origin требуется `Sec-Fetch-Site: same-origin`. Разрешены origin запроса, `SAFESIGN_ORIGIN`, а также localhost и 127.0.0.1 того же протокола и порта. Клон может получить challenge через prepare. Регистрация и подпись отдельно сверяют origin банка. Для одного отправителя допускается 32 активных первичных challenge. Следующая подготовка получает 429, а истечение TTL освобождает квоту. |
| RT-04, RT-05 | На страницах действуют CSP с одноразовым nonce для скриптов Next, `default-src 'self'`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff` и `Referrer-Policy: strict-origin-when-cross-origin`. WebAuthn разрешён своему origin. Inline-стили нужны интерфейсу и анимациям. Только dev разрешает `unsafe-eval` для сборщика. Шифрование IndexedDB остаётся защитой данных при хранении. Аппаратная изоляция PQ-ключа от кода в том же origin остаётся задачей Production (§11). |
| RT-06 | Имена устройств и реквизиты проходят NFC и проверку управляющих и невидимых символов. Счёт допускает структуру казахстанского IBAN, карту из 16 цифр или телефон. Проверяется формат IBAN, включая буквенно-цифровую часть демо-счетов. Сервер сравнивает оригинальные подписанные данные, а в diff выводит управляющие символы видимыми Unicode-последовательностями. |
| RT-07 | «Спасено от мошенничества» включает отклонение Второй рукой и предотвращённое повторное списание по исполненной операции, один раз на txId. «Атак отражено» считает события. «Объём атакованных операций» суммирует исходные суммы уникальных операций. «Предотвращено подмен на сумму» суммирует суммы, которые пытались провести, из поля `amountTenge` в `tamperDiff`. Квантовая проба на 1 ₸ учитывается только в счётчике и технической телеметрии. В контрольном прогоне пяти событий вышло соответственно 15 000 ₸, 5, 60 000 ₸ и 500 000 ₸. |
| RT-08 | При исполнении подписанного запроса предупреждение, остаток, охлаждение и продуктовые лимиты проверяются на шаге 7 до расходования nonce. После отказа политики исходную операцию можно подтвердить повторно. Сочетание подмены и отсутствующего подтверждения даёт предусмотренный §14.1 ответ `403 ERR_WYSIWYS_TAMPERED`. Проверки доступности продукта при выдаче challenge сохранены. |
| RT-09 | Ошибка записи в SSE, отмена чтения и разрыв запроса освобождают heartbeat и подписку. Журнал и блокировки остаются локальными для процесса. Стенд запускается одним процессом. Для кластера потребуются общий журнал событий и атомарная работа с nonce в общем хранилище. |
| DEMO-02–05 и регистрация | Синхронные блокировки защищают подготовку, регистрацию, сброс и квантовый тест от повторного клика. После F5 стенд загружает последнее ожидание второй подписи у отправителя. Устаревший `?txId` закрывается при 404 с очисткой URL. Истёкший вызов можно подготовить заново из модалки. После отмены TouchID доступны повторный Passkey и явный выбор Software Key. Регистрация и исполнение на другом порту localhost проверены тестом. Для отдельного телефона нужен доступный HTTPS-адрес с настроенными `SAFESIGN_ORIGIN` и `SAFESIGN_RP_ID`. |
| Сброс на нескольких устройствах | Открытая вкладка при получении сброса с удалением Passkeys сверяет локальные ключи с сервером и удаляет отозванные записи. Новая регистрация, успевшая завершиться до доставки старого события, сохраняется. На отключённом устройстве доступность ключа проверяется по списку серверных устройств. |

Проверки охватывают REST, реальные подписи Software Key, изоляцию событий, мультиплексор, агрегаты SOC и повторное исполнение после отказа политики. Работа аппаратного TouchID и поведение приватного режима Safari требуют проверки на соответствующем устройстве.

Итог проверки: `npm run lint` и `npm run build` прошли. Vitest выполнил 139 тестов в 11 файлах, из них 137 прошли обычным образом и два воспроизвели ожидаемый отказ требования (RT-01 и межпроцессная атомарность AUDIT-03). В dev и после `next start --port 3105` curl получил HTTP 200 для `/`, `/cosign`, `/soc`, `/roi` и `/phishing-clone`. Проверены заголовки и совпадение CSP nonce с HTML. В проверке React-хуков с реальным SSE пять подписчиков использовали одно соединение. При четырёх открытых потоках и лимите шесть соединений HTTP/1.1 три параллельных запроса API завершились с HTTP 200.
