import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { POST as options } from "@/app/api/auth/register/options/route";
import { POST as verify } from "@/app/api/auth/register/verify/route";
import { POST as prepare } from "@/app/api/transactions/prepare/route";
import { POST as execute } from "@/app/api/transactions/execute/route";
import { GET as users } from "@/app/api/users/route";
import { POST as reset } from "@/app/api/demo/reset/route";
import {
  armInterceptor, buildExecuteBody, DROP_ACCOUNT, foreignOriginFor, MITM_AMOUNT_TENGE, rememberValidPacket,
  replayLastPacket, resetAttackState,
} from "@/components/hacker/attacks";
import type { ExecuteInput } from "@/lib/client/api";
import { assertSoftware, registerSoftware } from "@/lib/crypto/software-authenticator";
import { toBase64 } from "@/lib/crypto/canonical";
import { createPqProofOfPossession, keygen, primaryMessage, sign } from "@/lib/crypto/mldsa";
import { recipientPresets } from "@/lib/db/seed";
import type { CanonicalTxPayload } from "@/lib/db/types";

// The attack panel's functions run against the real route handlers: nothing is decided on the client.
const bank = "http://localhost:3000";
const aigul = "usr_aigul";
const low = { senderId: aigul, mode: "B2C", operationType: "P2P_TRANSFER", purpose: "На продукты", ...recipientPresets.son };

function req(path: string, body?: unknown) {
  return new Request(bank + "/api/" + path, body === undefined ? { headers: { Origin: bank } } : {
    method: "POST", headers: { "Content-Type": "application/json", Origin: bank }, body: JSON.stringify(body),
  });
}

async function json(response: Promise<Response>) {
  const res = await response;
  return { status: res.status, body: await res.json() };
}

async function enroll() {
  const input = { deviceName: "Software Key", userId: aigul };
  const opts = (await json(options(req("auth/register/options", input)))).body as PublicKeyCredentialCreationOptionsJSON & { challengeId: string };
  const { response, credential } = await registerSoftware(opts);
  const pq = keygen();
  const { body } = await json(verify(req("auth/register/verify", {
    ...input, deviceKind: "SOFTWARE_FALLBACK", challengeId: opts.challengeId, attestationResponse: response,
    pqPublicKeyBase64: toBase64(pq.publicKey), pqProofOfPossessionBase64: createPqProofOfPossession(aigul, response.id, opts.challenge, pq.secretKey),
  })));
  return { deviceId: String(body.device.id), credential, pq };
}

async function signedBody(signer: Awaited<ReturnType<typeof enroll>>, originOverride?: string): Promise<ExecuteInput> {
  const { body: tx } = await json(prepare(req("transactions/prepare", low))) as {
    body: { txId: string; payload: CanonicalTxPayload; txHashHex: string; webAuthnOptions: PublicKeyCredentialRequestOptionsJSON };
  };
  return {
    txId: tx.txId, deviceId: signer.deviceId, submittedPayload: tx.payload,
    webAuthnAssertion: await assertSoftware(signer.credential, tx.webAuthnOptions, { originOverride }),
    pqSignatureBase64: toBase64(sign(primaryMessage(hexToBytes(tx.txHashHex)), signer.pq.secretKey)),
  };
}

const send = (body: ExecuteInput) => json(execute(req("transactions/execute", body)));
async function balance() {
  const { body } = await json(users(req("users")));
  return (body.users as Array<{ id: string; balanceTenge: number }>).find(user => user.id === aigul)!.balanceTenge;
}

beforeEach(async () => {
  vi.stubEnv("SAFESIGN_STORAGE", "memory");
  resetAttackState();
  await json(reset(req("demo/reset", { keepDevices: false })));
  // The panel calls the API through fetch; route those calls to the real handler.
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    execute(new Request(bank + url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: bank } })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Hacker panel → real /api/transactions/execute", () => {
  it("MITM amount: client signs 15 000 ₸, interceptor submits 500 000 ₸, server answers 403 with diff", async () => {
    const signer = await enroll();
    const before = await balance();
    armInterceptor("MITM_AMOUNT");
    const body = buildExecuteBody(await signedBody(signer));
    expect(body.attackTag).toBe("MITM_AMOUNT");
    expect((body.submittedPayload as CanonicalTxPayload).amountTenge).toBe(MITM_AMOUNT_TENGE);
    const { status, body: res } = await send(body);
    expect(status).toBe(403);
    expect(res.failureCode).toBe("ERR_WYSIWYS_TAMPERED");
    expect(res.tamperDiff).toContainEqual(expect.objectContaining({ field: "amountTenge", original: "15000", tampered: "500000" }));
    const failed = (res.verificationTrace as Array<{ step: number; outcome: string }>).filter(s => s.outcome === "FAIL").map(s => s.step);
    expect(failed).toEqual(expect.arrayContaining([3, 5, 6]));
    expect(await balance()).toBe(before);
  });

  it("MITM recipient: interceptor fires once and the server rejects the swapped IBAN", async () => {
    const signer = await enroll();
    armInterceptor("MITM_RECIPIENT");
    const tampered = buildExecuteBody(await signedBody(signer));
    expect((tampered.submittedPayload as CanonicalTxPayload).recipientAccount).toBe(DROP_ACCOUNT);
    const { status, body } = await send(tampered);
    expect([status, body.failureCode]).toEqual([403, "ERR_WYSIWYS_TAMPERED"]);
    expect(body.tamperDiff).toContainEqual(expect.objectContaining({ field: "recipientAccount", tampered: DROP_ACCOUNT }));
    const clean = buildExecuteBody(await signedBody(signer));
    expect(clean.attackTag).toBe("NONE");
    expect((await send(clean)).status).toBe(200);
  });

  it("Replay: the captured valid packet is resent byte-for-byte and the server answers 403 ERR_REPLAY_DETECTED", async () => {
    const signer = await enroll();
    const body = buildExecuteBody(await signedBody(signer));
    const first = await send(body);
    expect([first.status, first.body.status]).toEqual([200, "EXECUTED"]);
    rememberValidPacket(body, first.body.status);
    const afterFirst = await balance();
    const replay = await replayLastPacket();
    expect(replay?.result.ok).toBe(false);
    expect(replay?.result.status).toBe(403);
    expect(replay?.result.error?.failureCode).toBe("ERR_REPLAY_DETECTED");
    expect(await balance()).toBe(afterFirst);
  });

  it("Foreign origin: an assertion produced on the clone's origin is rejected with 403 ERR_ORIGIN_MISMATCH", async () => {
    const signer = await enroll();
    const foreign = foreignOriginFor({ protocol: "http:", port: "3000" });
    expect(foreign).toBe("http://127.0.0.1:3000");
    const { status, body } = await send({ ...await signedBody(signer, foreign), attackTag: "PHISHING_ORIGIN" });
    expect([status, body.failureCode]).toEqual([403, "ERR_ORIGIN_MISMATCH"]);
  });
});
