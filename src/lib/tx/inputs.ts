import { z } from "zod";

export const text = z.string().trim().min(1).max(256);
const mode = z.enum(["B2C", "B2B"]);
const operationType = z.enum(["P2P_TRANSFER", "DEPOSIT_CLOSE", "ONLINE_LOAN", "B2B_INVOICE"]);
// Bound normalization work even for decomposed Unicode input.
const displayText = z.string().max(560).pipe(z.string().refine(value => !/[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}]/u.test(value),
  "Имя получателя и назначение платежа не могут содержать управляющие или невидимые символы")
  .transform(value => value.normalize("NFC")));

export const prepareSchema = z.object({
  senderId: text, mode, operationType,
  recipientName: displayText.pipe(z.string().trim().min(1).max(120)), recipientAccount: text,
  amountTenge: z.number().int().positive(), purpose: displayText.pipe(z.string().max(140)),
  simulatedContext: z.object({ activeUnknownCall: z.boolean().optional(), nightTimeOverride: z.boolean().optional() }).optional(),
});
export const riskPreviewSchema = prepareSchema.pick({
  senderId: true, mode: true, operationType: true, amountTenge: true, recipientAccount: true, simulatedContext: true,
});

export const clientDataJSON = z.string().min(1).max(8192);
export const authenticatorData = z.string().min(1).max(8192);
const assertionSchema = z.object({
  id: z.string().min(1).max(1400), rawId: z.string().min(1).max(1400), type: z.literal("public-key"),
  clientExtensionResults: z.object({}),
  response: z.object({
    clientDataJSON, authenticatorData, signature: z.string().min(1).max(2048), userHandle: z.string().max(128).optional(),
  }),
});
const signedFields = {
  clientTimings: z.object({ webauthnMs: z.number().nonnegative(), pqSignMs: z.number().nonnegative() }).optional(),
  txId: text, deviceId: text, webAuthnAssertion: assertionSchema, pqSignatureBase64: z.string().min(1).max(6000),
};

// Preserve the submitted bytes and amount type for WYSIWYS diagnostics.
const field = z.string().min(1).max(256);
const timestamp = z.string().max(40).pipe(z.iso.datetime());
const submittedPayload = z.object({
  amountTenge: z.union([z.number(), z.string().max(140)]),
  createdAt: timestamp, currency: z.literal("KZT"), expiresAt: timestamp,
  mode, nonce: z.string().regex(/^[0-9a-f]{64}$/), operationType, purpose: z.string().max(140),
  recipientAccount: field, recipientName: z.string().min(1).max(120), rpId: field,
  senderAccount: field, senderId: field, txId: field, version: z.literal("1.0"),
}).strict();

export const executeSchema = z.object({
  ...signedFields, submittedPayload, acknowledgedWarning: z.boolean().optional(),
  attackTag: z.enum(["NONE", "MITM_AMOUNT", "MITM_RECIPIENT", "REPLAY", "PHISHING_ORIGIN"]).optional(),
  quantumSimulation: z.boolean().optional(),
});
export const cosignSubmitSchema = z.object({ ...signedFields, submittedPayload: submittedPayload.optional() });
export const cosignerSchema = z.object({ txId: text, cosignerUserId: text });
export const rejectSchema = cosignerSchema.extend({
  reason: z.literal("SUSPECTED_SCAM").default("SUSPECTED_SCAM"), activateCoolingOff: z.boolean().default(true),
});
