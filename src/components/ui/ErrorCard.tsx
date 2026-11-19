import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Card } from "./Card";

const copy: Partial<Record<string, [title: string, description: string]>> = {
  ERR_TX_NOT_FOUND: ["Транзакция не найдена", "Запрос на подпись устарел или был сброшен. Создайте операцию заново."],
  ERR_TX_EXPIRED: ["Время подписи истекло", "Одноразовый вызов аннулирован. Подготовьте реквизиты заново."],
  ERR_REPLAY_DETECTED: ["Повторная атака заблокирована", "Одноразовый пакет подписи уже был использован."],
  ERR_WYSIWYS_TAMPERED: ["Обнаружена подмена реквизитов!", "Данные перевода изменились после подписи. Сервер отклонил операцию."],
  ERR_ORIGIN_MISMATCH: ["Фишинг заблокирован", "Домен подписи или запроса отличается от домена банка."],
  ERR_WEBAUTHN_INVALID: ["Подпись устройства не прошла проверку", "Passkey или программный ключ не подтвердил запрос SafeSign."],
  ERR_PQ_SIGNATURE_INVALID: ["Постквантовая подпись недействительна", "Проверка подписи ML-DSA-65 отклонена."],
  ERR_COSIGN_SIGNATURE_INVALID: ["Вторая подпись не прошла проверку", "Подпись доверенного лица не совпадает с криптоцепочкой операции."],
  ERR_COSIGN_ALREADY_DECIDED: ["Решение уже принято", "Эта операция уже была подтверждена или заблокирована."],
  ERR_ACCOUNT_COOLING_OFF: ["Счёт в режиме охлаждения", "Переводы временно приостановлены по просьбе доверенного лица."],
  ERR_DEVICE_NOT_REGISTERED: ["Устройство не привязано", "Привяжите Passkey или программный ключ для этого пользователя."],
  ERR_WEBAUTHN_CANCELLED: ["Подтверждение устройством отменено", "Повторите подпись, когда будете готовы."],
  ERR_WEBAUTHN_UNSUPPORTED: ["Passkey недоступен", "Для демо можно использовать программный ключ, если браузер поддерживает WebCrypto."],
  ERR_VALIDATION_FAILED: ["Проверьте данные запроса", "Некоторые поля запроса заполнены некорректно."],
  ERR_NETWORK_TIMEOUT: ["Сервер не ответил вовремя", "Проверьте состояние операции перед повторной отправкой."],
  ERR_NETWORK: ["Соединение с сервером прервано", "Проверьте состояние операции перед повторной отправкой."],
  ERR_TX_STATE: ["Состояние операции изменилось", "Обновите сведения об операции перед повторной попыткой."],
  ERR_USER_NOT_FOUND: ["Пользователь не найден", "Проверьте выбранного участника демо."],
  ERR_COSIGNER: ["Подтверждение недоступно", "Вторую подпись может поставить назначенное доверенное лицо со своего устройства."],
  ERR_INSUFFICIENT_FUNDS: ["Недостаточно средств", "Проверьте баланс и сумму операции."],
  ERR_ACK_REQUIRED: ["Подтвердите условия операции", "Ознакомьтесь с предупреждением на Экране отрезвления и подтвердите его."],
  ERR_SIMULATION_ONLY: ["Диагностический сценарий", "Сервер остановил операцию по правилам симуляции."],
  ERR_STORAGE: ["Хранилище сервера недоступно", "Обновите состояние демо и повторите запрос."],
};

const aliases: Record<string, string> = {
  ERR_DEVICE_NOT_FOUND: "ERR_DEVICE_NOT_REGISTERED",
  ERR_COOLING_OFF: "ERR_ACCOUNT_COOLING_OFF",
  ERR_INVALID_INPUT: "ERR_VALIDATION_FAILED",
};

export function ErrorCard({ error, title, action, children, className = "" }: {
  error: { status?: string; failureCode: string; message: string };
  title?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string;
}) {
  const known = copy[aliases[error.failureCode] ?? error.failureCode];
  return (
    <Card variant="danger" role="alert" className={className}>
      <div className="flex items-start gap-3">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger-text" />
        <div className="min-w-0 space-y-2">
          <h3 className="type-h3">{title ?? known?.[0] ?? "Не удалось завершить действие"}</h3>
          <p className="text-sm text-ink-secondary">{known?.[1] ?? (error.message || "Повторите попытку или сбросьте демо.")}</p>
          <Badge tone="danger" className="max-w-full !whitespace-normal break-all font-mono text-[13px] font-bold tabular-nums">{error.failureCode}</Badge>
          {children}
          {action && <div>{action}</div>}
        </div>
      </div>
    </Card>
  );
}
