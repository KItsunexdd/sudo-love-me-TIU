# Независимый аудит криптографии и безопасности ядра BCC SafeSign

Область аудита: `src/lib/**`, `tests/**`, соответствие ТЗ кейса (§4, §5, §8, §10, §11), а также проверка установленных криптографических зависимостей (`@noble/post-quantum` v0.7.1, `@simplewebauthn/server` v14.1.0, `zod` v4.6.7).

> Примечание: в рамках данного аудита API-маршруты `src/app/api/**` ещё не присутствовали в репозитории, поэтому проверка охватывает доменное, криптографическое и транзакционное ядро (`src/lib/**`).

Разделы 1 и 2 описывают состояние на момент аудита. Итоги изменений ядра и HTTP API приведены в разделе «Статус исправлений».

---

## 1. Сводная сводка по ключевым вопросам проверки

| Область проверки | Вердикт | Краткий итог |
|---|---|---|
| **Canonical JSON (§4.1)** | Частично соответствует (см. `AUDIT-05`, `AUDIT-06`) | Ключи сортируются рекурсивно лексикографически (в т.ч. вложенные объекты и числовые ключи); `-0` нормализуется к `"0"`; прототипы и не-JSON типы отвергаются. Однако нет NFC-нормализации и фильтрации bidi/управляющих символов, нет лимита глубины, `amountTenge` допускает `<= 0` в `canonical.ts`, а нецелый `amountTenge` в `submittedPayload` ломает WYSIWYS-диагностику. |
| **WebAuthn challenge из присланного payload** | Соответствует | Для `primary` сервер вычисляет `SHA-256(canonical(submittedPayload))` и передаёт `base64url(hashBytes)` в `verifyAuthenticationResponse`. При расхождении с сохранённым `txHashHex` сервер честно прогоняет шаги 4–6 против *присланного* `submittedPayload`. Для `cosign` challenge равен `base64url(SHA-256("BCC-SAFESIGN-V1:COSIGN:" \|\| txHash \|\| SHA-256(primarySig)))` (если `submittedPayload` не передан, используется `record.payload`). |
| **Атомарность nonce и гонки** | В одном процессе — да; между процессами — уязвимо (`AUDIT-03`, `AUDIT-02`) | Внутри одного процесса Node.js `Mutex` в `SerializedAdapter` сериализует `transact()`, поэтому параллельный `Promise.all` пропускает строго один запрос. Но у `JsonFileAdapter` нет файловой блокировки ОС / CAS-версионирования, а `MemoryAdapter` изолирован по инстансам. Кроме того, `nonce` сжигается до аутентификации устройства (`AUDIT-02`). |
| **Аргументы `ml_dsa65.sign/verify`** | Корректно | В `@noble/post-quantum` v0.7.1 сигнатуры `sign(msg, secretKey)` и `verify(sig, msg, publicKey)`. Обёртка `src/lib/crypto/mldsa.ts:25-28` и вызов в `hybrid-verifier.ts:134` передают аргументы в точном порядке v0.7.1 (в отличие от псевдокода §4.3/§4.4 ТЗ, отражавшего старый API). |
| **Domain separation PRIMARY / COSIGN** | Корректно, с оговоркой при регистрации (`AUDIT-01`) | Префиксы `BCC-SAFESIGN-V1:PRIMARY:` и `BCC-SAFESIGN-V1:COSIGN:` + привязка к `SHA-256(primarySignature)` разделяют и ML-DSA, и WebAuthn challenge для `cosign`. `enforceIndependentDevice` запрещает переиспользование пользователя, `credentialId`, `webAuthnPublicKey` и `pqPublicKey`. |
| **`userVerified`, `signCount`, `origin`** | Надежно, с мелким замечанием (`AUDIT-09`) | `requireUserVerification: true` включён при регистрации и аутентификации. `signCount` проверяется `@simplewebauthn/server` и обновляется в шаге 7. Подмена HTTP-заголовка `Origin` не обходит проверку: проверяется и `context.requestOrigin`, и подписанный `clientDataJSON.origin`, и `rpIdHash`, и подпись ECDSA. Не проверяется `crossOrigin === true` без `topOrigin`. |
| **Software Authenticator** | Честная криптография | Нет «короткого пути» на сервере: `software-authenticator.ts` генерирует неэкспортируемый ключ ECDSA P-256, кодирует COSE/CBOR и ASN.1 DER-подпись, а сервер всегда проверяет через `@simplewebauthn/server`. |
| **Атака №6 (квантовая симуляция)** | Честная криптография | При `quantumSimulation: true` шаг 5 помечается `COMPROMISED`, а шаг 6 реально проверяет ML-DSA-65 через `ml_dsa65.verify`. Поддельная PQ-подпись отклоняется с `ERR_PQ_SIGNATURE_INVALID`, а подлинная блокируется на шаге 7 через `ERR_SIMULATION_ONLY` без списания средств. |
| **Risk Engine (§5.1–5.2)** | Соответствует | Все 8 правил, веса, ограничение `[0, 100]`, часовой пояс `Asia/Almaty` (`[00:00, 06:00)`) и пороги `0–39` (`LOW`), `40–59` (`MEDIUM`), `60–100` (`HIGH`) полностью совпадают с §5.1–5.2. |
| **TTL и машина состояний (§5.3)** | В основном корректно; есть DoS через чужой `deviceId` (`AUDIT-02`) | Исполнение `EXPIRED`, `BLOCKED_BY_COSIGNER`, двойной `cosign` и self-cosign заблокированы. Однако попытка `execute` или `cosignSubmit` с чужим `deviceId` или неверными данными до аутентификации сжигает `nonce` и переводит транзакцию в `REJECTED_CRYPTO`. |
| **Деньги, баланс, cooling-off** | Защищено от овердрафта; есть логические пробелы (`AUDIT-07`) | Внутри одного процесса двойное списание и отрицательный баланс невозможны; `coolingOffUntil` проверяется и в `prepare`, и перед расчётом (`applyPolicy`). Но в `ONLINE_LOAN` отсутствует кредитный лимит (и при сумме `< 200 000 ₸` доверенному лицу `score = 55`, без Co-Sign), а `DEPOSIT_CLOSE` допускает прямой перевод внешнему получателю. |

---

## 2. Находки по серьёзности

### CRITICAL

Критических уязвимостей, позволяющих в текущей конфигурации напрямую подделать подпись или списать средства без валидной криптографической подписи в одном процессе, не выявлено.

---

### HIGH

#### [AUDIT-01] Отсутствие Proof-of-Possession (PoP), привязки к WebAuthn и проверки вырожденных ключей ($t_1 = 0$) при регистрации `pqPublicKey`

- **Местоположение:** `src/lib/crypto/webauthn.ts:35-60` (`verifyRegistration`), `src/lib/crypto/mldsa.ts:26-28` (`verify`)
- **Сценарий атаки:**
  1. `verifyRegistration` проверяет только длину декодированного `pqPublicKeyBase64` (`publicKey.length === ML_DSA_BYTES.publicKey`, `webauthn.ts:40-43`), не требуя подписи Proof-of-Possession от закрытого ключа ML-DSA-65 и не связывая `pqPublicKey` с `expectedChallenge` в WebAuthn-аттестации.
  2. Также отсутствует проверка вырожденных ключей, у которых полиномиальная часть $t_1 = 0$ (байты `publicKey.subarray(32)` равны нулю, например `new Uint8Array(1952)`). В ML-DSA-65 верификатор вычисляет $w'_{\text{approx}} = A \cdot z - c \cdot t_1 \cdot 2^d$. При $t_1 = 0$ (что соответствует $s_1 = 0, s_2 = 0$) произвольный злоумышленник может для **любого** сообщения $M$ сформировать валидную подпись $(z = 0, h = 0, \tilde{c} = \text{SHAKE256}(\mu \parallel W_1(0)))$, для которой `ml_dsa65.verify(sig, msg, zeroPk)` возвращает `true` без знания какого-либо секретного ключа.
  3. Дополнительно при регистрации не проверяется уникальность `credential.id`, `webAuthnPublicKey` и `pqPublicKey` между пользователями/устройствами (дубликаты отлавливаются только позднее на этапе `cosignSubmit` через `enforceIndependentDevice`).
- **Последствия:**
  Подмена или сбой `pqPublicKeyBase64` при онбординге на нулевой/вырожденный ключ (или ключ злоумышленника) полностью лишает транзакцию постквантовой защиты: подпись ML-DSA-65 подделывается тривиально за доли миллисекунды.
- **Предлагаемое исправление:**
  1. Требовать в `verifyRegistration` поле `pqProofBase64` — подпись `ml_dsa65.sign("BCC-SAFESIGN-V1:REGISTER:" || utf8(expectedChallenge) || utf8(credential.id), pqSecretKey)` — и проверять её через `verify(...)`.
  2. Явно отклонять вырожденные открытые ключи, где `publicKey.subarray(32)` состоит из одних нулей ($t_1 = 0$).
  3. Включать `SHA-256(pqPublicKey)` в registration challenge (или проверять привязку в церемонии регистрации) и проверять глобальную уникальность `credentialId` / `pqPublicKey` по `db.devices`.

---

#### [AUDIT-02] Сжигание `nonce` и необратимый перевод транзакции в `REJECTED_CRYPTO` до аутентификации устройства и проверки политик (Pre-Auth DoS)

- **Местоположение:** `src/lib/crypto/hybrid-verifier.ts:87-89` (шаг 2), `src/lib/crypto/hybrid-verifier.ts:119-125` (шаг 5), `src/lib/tx/service.ts:88-104` (`recordFailure`), `src/lib/tx/service.ts:176-189` (`applyPolicy`)
- **Сценарий атаки:**
  1. Шаг 2 (`unit.consumeNonce(record.id, role)`) необратимо помечает `nonceUsed = true` / `cosignNonceUsed = true` **до** проверки валидности `submittedPayload` (шаг 3), `origin` (шаг 4), принадлежности `deviceId` целевому пользователю и подлинности подписей (шаги 5–6), а также до проверок бизнес-политик на шаге 7 (`ERR_ACK_REQUIRED`, `ERR_COOLING_OFF`, `ERR_INSUFFICIENT_FUNDS`, `ERR_SIMULATION_ONLY`).
  2. `recordFailure` (`service.ts:96-102`) при прохождении шага 2 (`result.verificationTrace[1]?.passed`) переводит транзакцию в терминальный статус `REJECTED_CRYPTO`.
  3. Любой субъект, знающий `txId` (в т.ч. сам инициатор перевода `usr_aigul`, получивший `txId` в `prepare`, или наблюдатель потока SSE `COSIGN_REQUESTED`), может вызвать `cosignSubmit` со своим `deviceId` (или несуществующим `deviceId`) и фиктивными подписями. Шаг 2 сожжёт `cosignNonceUsed`, шаг 5 упадёт с `ERR_WEBAUTHN_INVALID`, а транзакция станет `REJECTED_CRYPTO`. После этого доверенное лицо (`usr_arman` / `usr_timur`) **не сможет** ни подтвердить, ни вызвать `cosignReject` для активации 24-часового `coolingOffUntil`.
  4. Аналогично легитимный клиент с валидными подписями на операции `MEDIUM`-риска, забывший флаг `acknowledgedWarning: true`, получает `ERR_ACK_REQUIRED`, сжигание `nonce` и ложный статус `REJECTED_CRYPTO` вместо возможности подтвердить предупреждение.
- **Последствия:**
  - DoS против транзакций в `CHALLENGE_ISSUED` и `PENDING_COSIGN` без владения ключом подписанта.
  - Блокировка механизма экстренной заморозки `coolingOffUntil` через `cosignReject`.
  - Нарушение машины состояний §5.3: ошибки политик и ввода помечаются как `REJECTED_CRYPTO`.
- **Предлагаемое исправление:**
  1. Проверять существование и принадлежность `device` (`device.userId === signer`), `enforceIndependentDevice`, валидность структуры `submittedPayload` и `acknowledgedWarning` **до** вызова `consumeNonce` (в `cosignSubmit` несовпадение владельца устройства должно возвращать `ERR_COSIGNER` без мутации состояния транзакции).
  2. Оставлять `consumeNonce` перед криптографическими проверками только для уже аутентифицированного `deviceId` ожидаемого подписанта, либо списывать `nonce` атомарно вместе с фиксацией результата криптопроверки внутри транзакции БД.
  3. Не переводить транзакцию в `REJECTED_CRYPTO` при бизнес-ошибках шага 7 (`ERR_ACK_REQUIRED`, `ERR_INSUFFICIENT_FUNDS`, `ERR_COOLING_OFF`).

---

#### [AUDIT-03] Отсутствие межпроцессной блокировки и CAS-версионирования в `JsonFileAdapter` и `MemoryAdapter` (гонка Replay / двойное списание между воркерами)

- **Местоположение:** `src/lib/db/store.ts:20-42, 88-128` (`Mutex`, `SerializedAdapter`, `MemoryAdapter`, `JsonFileAdapter`)
- **Сценарий атаки:**
  1. `SerializedAdapter` использует только внутрипроцессный JS-объект `Mutex` в `globalThis.safeSignLocks`. Внутри одного процесса Node.js параллельные `execute` через `Promise.all` корректно сериализуются.
  2. Однако `JsonFileAdapter` (`store.ts:94-122`) не использует файловую блокировку уровня ОС (`flock` / lock-файл через `open(..., "wx")`) и не проверяет версию/хэш файла `store.json` перед атомарным `rename(tmp, this.path)`. При запуске двух и более воркеров/процессов или одновременном обращении к `./data/store.json` из разных процессов оба процесса читают `nonceUsed: false` и исходный баланс, оба успешно проверяют подписи, оба списывают баланс в памяти и второй `rename` перезаписывает файл первого.
  3. `MemoryAdapter` (выбираемый по умолчанию на Vercel при `VERCEL=1`, `store.ts:125`) хранит `safeSignMemory` и `safeSignLocks` в `globalThis` конкретного serverless-инстанса, что не синхронизируется между инстансами и сбрасывается при холодном старте.
- **Последствия:**
  В многопроцессной / кластерной / serverless-среде возможен обход `consumeNonce` (Replay Attack) и двойное списание баланса.
- **Предлагаемое исправление:**
  Для локального `JsonFileAdapter` добавить lock-файл (`wx`) или `flock` вокруг цикла `load -> action -> save` и/или оптимистический CAS по ревизии/хэшу. Для production / multi-instance среды (см. ТЗ §11) заменить хранение на атомарные транзакции PostgreSQL / Redis Lua (`GET`/`SET` с проверкой `nonceUsed = false`).

---

### MEDIUM

#### [AUDIT-04] Отсутствие ограничений размера и глубины для `submittedPayload`, `pqSignatureBase64` и полей WebAuthn (DoS и раздувание хранилища)

- **Местоположение:** `src/lib/tx/inputs.ts:15-31` (`assertionSchema`, `signedFields`, `payloadObject`, `executeSchema`, `cosignSubmitSchema`), `src/lib/crypto/canonical.ts:33-51` (`serializeCanonicalJSON`)
- **Сценарий атаки:**
  1. В отличие от `prepareSchema` (`text` <= 256, `purpose` <= 512), в `executeSchema` и `cosignSubmitSchema` поле `submittedPayload` проверяется лишь предикатом `v !== null && typeof v === "object" && !Array.isArray(v)` (`inputs.ts:25`), а `pqSignatureBase64` и поля `assertionSchema.response` являются неограниченными `z.string()`.
  2. Передача в `submittedPayload` глубоко вложенного объекта (например, 15 000 уровней `{ a: { a: ... } }`) вызывает переполнение стека (`RangeError: Maximum call stack size exceeded`) в рекурсивной `serializeCanonicalJSON` (перехватывается на шаге 3 как `ERR_INVALID_INPUT`, но сжигает `nonce` и тратит ресурсы).
  3. Передача в `submittedPayload.purpose` строки в сотни килобайт/мегабайт сохраняется в `tx.tamperDiff` и `db.securityEvents[].technicalDetails` (`service.ts:89, 98, 103`), раздувая `store.json`, память и SSE-сообщения.
- **Предлагаемое исправление:**
  Ограничить длину `pqSignatureBase64` (`max(4600)`), Base64URL-полей WebAuthn, максимальную глубину вложенности `submittedPayload` (например, `<= 4`), количество ключей (`<= 64`) и длину строковых полей (`<= 2048`), а также усекать значения в `tamperDiff` / `securityEvents`.

---

#### [AUDIT-05] Ошибка типа в `submittedPayload.amountTenge` маскирует `ERR_WYSIWYS_TAMPERED` под `ERR_INVALID_INPUT` и отключает диагностику шагов 4–6

- **Местоположение:** `src/lib/crypto/canonical.ts:34` (`serializeCanonicalJSON`), `src/lib/crypto/hybrid-verifier.ts:94-101`
- **Сценарий атаки:**
  1. `serializeCanonicalJSON` содержит правило `if (key === "amountTenge" && !Number.isSafeInteger(item)) throw new TypeError(...)` на любом уровне вложенности.
  2. Если атакующий в `submittedPayload` меняет `amountTenge` на дробное число (`15000.5`) или строку (`"500000"`), либо добавляет вложенный объект `{ extra: { amountTenge: "x" } }`, вызов `hashPayload(submitted)` на шаге 3 выбрасывает `TypeError`.
  3. `trace.check(3, "ERR_INVALID_INPUT", ...)` немедленно завершает проверку с кодом `ERR_INVALID_INPUT` (и событием `TX_POLICY_REJECTED`) вместо `ERR_WYSIWYS_TAMPERED` (`ATTACK_MITM_BLOCKED`), без `tamperDiff` и без прогона шагов 4–6, но при уже сожжённом `nonce`.
  4. Кроме того, сам `serializeCanonicalJSON({ amountTenge: 0 })` и `serializeCanonicalJSON({ amountTenge: -100 })` не отклоняют неположительные значения (поскольку `Number.isSafeInteger` для них истинно), хотя `prepareSchema` требует `.positive()`.
- **Предлагаемое исправление:**
  Сделать `serializeCanonicalJSON` чистым сериализатором RFC 8785 (без доменной привязки к имени ключа `amountTenge`), а валидацию схемы `CanonicalTxPayload` (`amountTenge > 0`) выполнять при создании/приёме транзакции. В шаге 3 при несовпадении типов в `submittedPayload` вычислять `tamperDiff` и возвращать `ERR_WYSIWYS_TAMPERED`.

---

#### [AUDIT-06] Отсутствие Unicode NFC-нормализации и фильтрации Bidi/управляющих символов (риск визуального спуфинга WYSIWYS)

- **Местоположение:** `src/lib/tx/inputs.ts:3, 8`, `src/lib/crypto/canonical.ts:35, 46`
- **Сценарий атаки:**
  `prepareSchema` допускает в `recipientName` и `purpose` символы двунаправленного управления (`U+202E` RLO, `U+2066`–`U+2069`), символы нулевой ширины (`U+200B`), переводы строк и ненормализованные формы NFD (`"И\u0306"` вместо NFC `"Й"`). При отображении реквизитов в WYSIWYS-модалке Bidi-переопределение способно визуально переставить символы назначения/получателя, оставаясь валидно подписанным, а NFD/NFC строки визуально неразличимы, но дают разные хэши.
- **Предлагаемое исправление:**
  В `prepareSchema` применять `.transform(s => s.normalize("NFC"))` и отклонять управляющие и bidi-символы `[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]`.

---

#### [AUDIT-07] Неограниченная выдача `ONLINE_LOAN`, пропуск Co-Sign при `< 200 000 ₸` и внешний вывод `DEPOSIT_CLOSE`

- **Местоположение:** `src/lib/tx/service.ts:61-80` (`fundingSource`, `settle`), `src/lib/risk/engine.ts:15-35` (`assessRisk`)
- **Сценарий атаки:**
  1. Для `ONLINE_LOAN` функция `fundingSource` не проверяет лимит кредитования, а `settle` ограничивает `loanBalanceTenge` только `Number.isSafeInteger` (до ~9 квадриллионов ₸).
  2. Правило `CRITICAL_OP_TYPE` даёт `+55` баллов при пороге Co-Sign `60` (§5.1–5.2). Следовательно, серия операций `ONLINE_LOAN` на суммы `199 999 ₸` в дневное время на счёт доверенного контакта (или сторонней организации из `trustedRecipients`) получает `riskScore = 55 (MEDIUM)` и исполняется **без Co-Sign** в неограниченном количестве.
  3. Операция `DEPOSIT_CLOSE` списывает `depositBalanceTenge` и позволяет указать любой внешний `recipientAccount` (вместо зачисления исключительно на собственный `sender.accountIban`), что при сумме `< 200 000 ₸` и доверенном получателе также укладывается в `55` баллов.
- **Предлагаемое исправление:**
  Ввести кредитный лимит для `ONLINE_LOAN` (или требовать Co-Sign для любого `ONLINE_LOAN`), а для `DEPOSIT_CLOSE` требовать `recipientAccount === sender.accountIban`.

---

#### [AUDIT-08] `cosignReject` не требует криптографической подписи доверенного лица (риск блокировки счёта при отсутствии сессионной авторизации)

- **Местоположение:** `src/lib/tx/service.ts:232-249` (`cosignReject`), `src/lib/tx/inputs.ts:32-34` (`rejectSchema`)
- **Сценарий атаки:**
  В отличие от `cosignSubmit`, метод `cosignReject` принимает только `{ txId, cosignerUserId, reason, activateCoolingOff }` (в соответствии с §7.3 ТЗ). На уровне сервисного слоя нет проверки подлинности сессии `cosignerUserId` или криптографического подтверждения. Если внешний вызывающий (получивший `txId` из SSE-потока) подставит `cosignerUserId` (например, `"usr_arman"`), он сможет отклонить операцию и наложить на клиента 24-часовую заморозку `coolingOffUntil`.
- **Предлагаемое исправление:**
  В API-слое аутентифицировать сессию доверенного лица и не принимать `cosignerUserId` из тела запроса как доверенный идентификатор (для `activateCoolingOff: true` в production — требовать подтверждение Passkey).

---

### LOW

#### [AUDIT-09] Допущение `crossOrigin: true` при отсутствии `topOrigin` и отсутствие сверки `userHandle`

- **Местоположение:** `src/lib/crypto/hybrid-verifier.ts:108-115`, `src/lib/crypto/webauthn.ts:69-79`
- **Детали:** В `@simplewebauthn/server` v14.1.0 (`verifyAuthenticationResponse.js:76-81`) при `crossOrigin: true` и отсутствии `topOrigin` (случай Safari) аутентификация не отклоняется; в шаге 4 `hybrid-verifier.ts` также нет явной проверки `data.crossOrigin !== true`. Дополнительно при наличии `assertion.response.userHandle` не сверяется его равенство `device.userId`.
- **Предлагаемое исправление:** Добавить в шаг 4 проверку `data.crossOrigin !== true` и проверку `userHandle` (если передан и непустой).

#### [AUDIT-10] `TransactionService.preview()` не обёрнут в Zero-Crash обработчик `this.run(...)`

- **Местоположение:** `src/lib/tx/service.ts:126-130`
- **Детали:** В отличие от остальных методов `TransactionService`, `preview(request)` вызывает `riskPreviewSchema.parse(request)` и `assessRequest(...)` напрямую без `try/catch` (`this.run`), выбрасывая необработанные `ZodError` / `TxError` вместо структурированного `Failure` (нарушение правила Zero-Crash из `AGENTS.md` §5, если вызывающий роут не оборачивает его сам).
- **Предлагаемое исправление:** Обернуть `preview` в `try/catch` аналогично `this.run` (без записи в БД).

#### [AUDIT-11] Fail-open при невалидной дате в `isExpired` и потеря привязки при удалении первого устройства до `cosignSubmit`

- **Местоположение:** `src/lib/crypto/hybrid-verifier.ts:64-68` (`isExpired`), `src/lib/crypto/hybrid-verifier.ts:123, 160-163` (`enforceIndependentDevice`)
- **Детали:**
  1. В `isExpired`: `now.getTime() >= Date.parse(deadline)` вернёт `false`, если `deadline` невалидная строка (`NaN`). Следует проверять `!Number.isFinite(ts) || now.getTime() >= ts`.
  2. В `enforceIndependentDevice`: если устройство инициатора удалено/отозвано между `execute` и `cosignSubmit`, `db.devices.find(...)` вернёт `undefined`, что заблокирует `cosignSubmit` с ошибкой `ERR_COSIGNER` (и сожжёт `cosignNonceUsed`). Достаточно хранить снимок `credentialId` / `pqPublicKey` / `signerUserId` в `SignatureBundle`.

#### [AUDIT-12] Расхождение стартового баланса `seed.ts` с §6.2 ТЗ

- **Местоположение:** `src/lib/db/seed.ts:17-18`
- **Детали:** `usr_aigul.balanceTenge` задан как `1_200_000` (осознанное отклонение для демо-сценария одобрения `850 000 ₸`), тогда как §6.2 ТЗ указывает `450 000 ₸`. Требуется синхронизация документации / демо-сценария с ТЗ §6.2.

## Статус исправлений

| Находка | Статус | Поведение после проверки |
|---|---|---|
| AUDIT-01 | Исправлено | Регистрация требует PoP, привязанный к пользователю, WebAuthn credential ID и выданному challenge. Сервер проверяет канонический Base64, длину ключа, ненулевой `t1` и подпись ML-DSA-65. Совпадение credential ID, открытого ключа WebAuthn или PQ с зарегистрированным устройством блокирует регистрацию. Верификатор также отклоняет вырожденные ключи в старых записях. |
| AUDIT-02 | Исправлено | Проверки устройства, полномочий, подтверждения предупреждения и применимых лимитов предшествуют криптографии. Шаг 2 `REPLAY_PROTECTION` отклоняет использованный nonce. В одном процессе успешный переход или конечный криптографический отказ атомарно расходует nonce соответствующей роли. При отказе политики транзакция сохраняет статус, nonce и возможность повторного подтверждения. |
| AUDIT-03 | Accepted risk (MVP) — Production: Redis atomic lock | Блокировка и гарантии однократного исполнения действуют в одном процессе. Межпроцессный сценарий остаётся ожидаемым падением `it.fails`. |
| AUDIT-04 | Исправлено | В execute и cosign действует строгая плоская схема реквизитов. Максимальная длина назначения составляет 140 символов, имени — 120, PQ-подписи в Base64 — 6000. Для `clientDataJSON` и `authenticatorData` предел составляет 8192 символа на поле. |
| AUDIT-05 | Исправлено | Prepare принимает положительную целую сумму в безопасном диапазоне. На шаге 3 дробная сумма и строковая подмена дают `ERR_WYSIWYS_TAMPERED` с пополевым сравнением. Шаги 4–6 проверяют присланный пакет. |
| AUDIT-06 | Исправлено | Prepare приводит имя получателя и назначение к NFC перед сохранением и хешированием. Управляющие и невидимые символы дают HTTP 400 с пояснением на русском. |
| AUDIT-07 | Исправлено по решению команды | В B2C закрытие депозита и онлайн-кредит всегда требуют второй подписи и отображаются как HIGH. Сохраняются веса §5.1 и рассчитанный балл. Депозит зачисляется на собственный счёт клиента. Выдача кредита ограничена общей задолженностью 3 000 000 ₸ с повторной проверкой при зачислении. |
| AUDIT-08 | Принятое продуктовое решение | Для «стоп-крана» достаточно `cosignerUserId`, совпадающего с назначенным для транзакции. Чужой ID даёт `ERR_COSIGNER`. Криптоподпись для отказа не требуется. Без сессионной аутентификации совпадение ID не удостоверяет личность вызывающего. |
| AUDIT-09 | Исправлено | Сервер отклоняет `crossOrigin: true` даже при отсутствии `topOrigin` и сверяет непустой `userHandle` с Base64URL идентификатора владельца устройства. |
| AUDIT-10 | Исправлено | Preview читает снимок хранилища и возвращает структурированный отказ при ошибке ввода, политики или хранилища. |
| AUDIT-11 | Исправлено | Повреждённый или отсутствующий срок активной операции переводит её в EXPIRED. Снимок первой подписи сохраняет пользователя, credential ID и оба открытых ключа. После отзыва устройства проверка независимости второй подписи использует этот снимок. |
| AUDIT-12 | Intentional deviation | Стартовые 1 200 000 ₸ на счёте Айгуль позволяют одобрить демо-перевод на 850 000 ₸. |

Клиент передаёт результат `createPqProofOfPossession(userId, attestationResponse.id, registrationChallenge, pqSecretKey)` в обязательном поле `pqProofOfPossessionBase64` запроса `POST /api/auth/register/verify`. Хелпер возвращает готовую строку Base64. Значение `registrationChallenge` берётся из `options.challenge` в исходном виде Base64URL. Обе стороны используют одно сообщение.

```text
utf8("BCC-SAFESIGN-V1:PQ-POP:") ||
SHA-256(utf8(userId) || 0x00 || utf8(attestationResponse.id) || 0x00 || utf8(registrationChallenge))
```

В формате открытого ключа ML-DSA-65 первые 32 байта содержат seed, остальные 1920 байт — плотно упакованные 10-битные коэффициенты `t1`. Все 1024 значения коэффициента представимы, свободных битов в кодировке нет. Поэтому после проверки длины и исключения `t1 = 0` пригодность предъявленного ключа при регистрации проверяется криптографически по PoP.

У старой ожидающей транзакции отсутствующие в снимке ключи можно получить из регистрации первого устройства. При отзыве через API сервер сначала дополняет снимок. Если до обновления уже были утрачены и регистрация, и сведения о ключах, подтверждение возвращает `ERR_COSIGNER`, сохраняя возможность отклонить операцию.
