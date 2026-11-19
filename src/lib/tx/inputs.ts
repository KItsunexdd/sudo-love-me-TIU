import { z } from "zod";

const text = z.string().trim().min(1).max(256);
export const prepareSchema = z.object({
  senderId: text, mode: z.enum(["B2C", "B2B"]),
  operationType: z.enum(["P2P_TRANSFER", "DEPOSIT_CLOSE", "ONLINE_LOAN", "B2B_INVOICE"]),
  recipientName: text, recipientAccount: text, amountTenge: z.number().int().positive(),
  purpose: z.string().max(512),
  simulatedContext: z.object({ activeUnknownCall: z.boolean().optional(), nightTimeOverride: z.boolean().optional() }).optional(),
});

const assertionSchema = z.object({
  id: z.string().min(1).max(1400), rawId: z.string().min(1).max(1400), type: z.literal("public-key"), clientExtensionResults: z.object({}).passthrough(),
  response: z.object({
    clientDataJSON: z.string(), authenticatorData: z.string(), signature: z.string(), userHandle: z.string().optional(),
  }),
});
const signedFields = {
  txId: text, deviceId: text, webAuthnAssertion: assertionSchema, pqSignatureBase64: z.string(),
};
// Keep every submitted key until after WYSIWYS verification, including unexpected extra fields.
const payloadObject = z.custom<object>(v => v !== null && typeof v === "object" && !Array.isArray(v));
export const executeSchema = z.object({
  ...signedFields, submittedPayload: payloadObject, acknowledgedWarning: z.boolean().optional(),
  quantumSimulation: z.boolean().optional(),
});
export const cosignSubmitSchema = z.object({ ...signedFields, submittedPayload: payloadObject.optional() });
export const cosignerSchema = z.object({ txId: text, cosignerUserId: text });
export const rejectSchema = cosignerSchema.extend({
  reason: z.literal("SUSPECTED_SCAM").default("SUSPECTED_SCAM"), activateCoolingOff: z.boolean().default(true),
});
