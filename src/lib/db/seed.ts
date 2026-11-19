import type { Database, Recipient } from "./types";

export const DROP_ACCOUNT = "KZ99856000000666DROP";
export const recipientPresets = {
  son: { recipientName: "Арман Сатыбалдиев", recipientAccount: "KZ148560000007721304", amountTenge: 15_000 },
  unknown: { recipientName: "Безопасный счёт НБРК", recipientAccount: DROP_ACCOUNT, amountTenge: 850_000 },
  supplier: { recipientName: "ТОО «СнабТехСервис»", recipientAccount: "KZ448560000003344556", amountTenge: 1_250_000 },
} satisfies Record<string, Recipient & { amountTenge: number }>;

export function createSeed(): Database {
  const { son, supplier } = recipientPresets;
  return {
    blacklist: [DROP_ACCOUNT], transactions: [], devices: [], securityEvents: [],
    users: [
      {
        id: "usr_aigul", fullName: "Айгуль Сатыбалдиева", role: "CLIENT_B2C",
        phone: "+77000000001", accountIban: "KZ868560000004512890", balanceTenge: 450_000,
        depositBalanceTenge: 2_500_000, linkedCosignerId: "usr_arman",
        trustedRecipients: [
          { recipientName: son.recipientName, recipientAccount: son.recipientAccount },
          { recipientName: "Аптека Europharma", recipientAccount: "KZ228560000001100221" },
          { recipientName: "Коммунальные услуги Алматы", recipientAccount: "KZ558560000009988112" },
        ],
      },
      {
        id: "usr_arman", fullName: son.recipientName, role: "COSIGNER_FAMILY",
        phone: "+77000000002", accountIban: son.recipientAccount,
        balanceTenge: 0, depositBalanceTenge: 0, trustedRecipients: [],
      },
      {
        id: "usr_dinara", fullName: "Динара Касымова", role: "ACCOUNTANT_B2B",
        phone: "+77000000003", accountIban: "KZ718560000008812345", balanceTenge: 18_400_000,
        depositBalanceTenge: 0, linkedCosignerId: "usr_timur",
        trustedRecipients: [{ recipientName: supplier.recipientName, recipientAccount: supplier.recipientAccount }],
      },
      {
        id: "usr_timur", fullName: "Тимур Бекмуратов", role: "DIRECTOR_B2B",
        phone: "+77000000004", accountIban: "KZ008560000000000004",
        balanceTenge: 0, depositBalanceTenge: 0, trustedRecipients: [],
      },
    ],
  };
}
