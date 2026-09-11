// Observe > Reason > Act agent on Stellar testnet.
import "dotenv/config";
import { statSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { assertTestnetConfig, feeCollarTripped, xlmToStroops } from "./validate.js";
import { ensureFunded, executeActs, getBalance, getNetworkFeeMode } from "./rpc.js";
import { FEE_COLLAR_MULTIPLE, FEE_REFERENCE_STROOPS, PUBLIC_KEY_PREVIEW_LEN } from "./config.js";
import { ConfigError, exitCodeOf } from "./errors.js";
import { X402_PRICE, getPaidInsight, isPaymentRequired } from "./x402-mock.js";
import { appendRunRecord, type RunRecord } from "./audit.js";

const MIN_RUN_BALANCE_XLM = "1";
const IDENTITY_KEY = "agent.ai.role";
const IDENTITY_VALUE = "tiny-observe-reason-act";
const IDENTITY_UPDATED_KEY = "agent.ai.updated";
const ENV_MODE_MASK = 0o777;
const ENV_GROUP_OTHER_BITS = 0o077;
const ENV_MODE_RADIX = 8;

let currentRun: RunRecord | null = null;

function warnIfEnvExposed(): void {
  let mode: number;
  try {
    mode = statSync(".env").mode & ENV_MODE_MASK;
  } catch {
    return; // no .env file — nothing to check
  }
  if (mode & ENV_GROUP_OTHER_BITS) {
    console.warn(
      `⚠️  .env is mode ${mode.toString(ENV_MODE_RADIX)} (readable beyond owner) — run: chmod 600 .env`,
    );
  }
}

function loadKeypair(): { kp: Keypair; ephemeral: boolean } {
  const secret = process.env.SECRET_KEY?.trim();
  if (secret) {
    warnIfEnvExposed();
    try {
      return { kp: Keypair.fromSecret(secret), ephemeral: false };
    } catch {
      throw new ConfigError("SECRET_KEY is malformed (expected StrKey secret starting with 'S')");
    }
  }
  // In-memory only: the secret is never printed, save it to .env to persist.
  const kp = Keypair.random();
  console.log("🔑 No SECRET_KEY — ephemeral in-memory identity (not persisted):");
  console.log(`   public: ${kp.publicKey()}`);
  console.log("   👉 To reuse it, generate your own:");
  console.log(
    `      npx tsx -e "import {Keypair} from '@stellar/stellar-sdk'; console.log(Keypair.random().secret())"`,
  );
  console.log("   then save as SECRET_KEY=... in .env (never commit it).\n");
  return { kp, ephemeral: true };
}

/** Balance check (+ fund unless dry-run); null ends a dry-run. */
async function observe(pub: string, dryRun: boolean, rec: RunRecord): Promise<string | null> {
  console.log("👁️  OBSERVE: checking balance on Horizon testnet…");
  const balance = await getBalance(pub);
  if (balance !== null) {
    rec.balanceBefore = balance;
    console.log(`   Balance: ${balance} XLM\n`);
    if (xlmToStroops(balance) < xlmToStroops(MIN_RUN_BALANCE_XLM)) {
      throw new ConfigError(
        `balance ${balance} XLM below minimum ${MIN_RUN_BALANCE_XLM} XLM — fund via Friendbot and retry`,
      );
    }
    return balance;
  }
  console.log("   Account not found (unfunded).");
  if (dryRun) {
    console.log("   [dry-run] would fund via Friendbot, then submit ONE atomic tx:");
    console.log(
      `   [dry-run]   payment ${X402_PRICE} XLM → ${pub.slice(0, PUBLIC_KEY_PREVIEW_LEN)}… (x402 fee)`,
    );
    console.log(`   [dry-run]   manageData ${IDENTITY_KEY}=${IDENTITY_VALUE}`);
    rec.result = "ok";
    appendRunRecord(rec);
    console.log("\n✅ Dry-run complete. No writes made.");
    return null;
  }
  await ensureFunded(pub);
  const funded = await getBalance(pub);
  if (funded === null)
    throw new ConfigError("funding failed: account still missing after Friendbot");
  rec.balanceBefore = funded;
  console.log(`   Balance: ${funded} XLM\n`);
  return funded;
}

/** Request insight, then pay the 402 fee + write identity in one atomic tx. */
async function reasonAndAct(
  pub: string,
  secret: string,
  dryRun: boolean,
  rec: RunRecord,
): Promise<string | null> {
  console.log("🧠 REASON: requesting paid insight (x402, verified onchain)…");
  try {
    // Request without receipt first: a 402 is the expected path.
    await getPaidInsight({ payTo: pub });
    throw new Error("unreachable: insight served without payment");
  } catch (err) {
    if (!isPaymentRequired(err)) throw err;
    console.log(`   💳 402 Payment Required: ${err.amount} XLM testnet`);
    if (dryRun) {
      console.log("   [dry-run] would submit ONE atomic tx (payment + manageData),");
      console.log("   [dry-run] then verify the receipt on Horizon and redeem the insight.");
      rec.result = "ok";
      appendRunRecord(rec);
      console.log("\n✅ Dry-run complete. No writes made.");
      return null;
    }
    // One atomic tx: fee payment + identity heartbeat (all ops settle or none).
    console.log("⚡ ACT: atomic tx (x402 fee + identity heartbeat)…");
    const txHash = await executeActs(secret, {
      destination: pub, // self-payment keeps testnet funds
      amount: X402_PRICE,
      memo: "x402-fee",
      dataEntries: [
        { key: IDENTITY_KEY, value: IDENTITY_VALUE },
        { key: IDENTITY_UPDATED_KEY, value: new Date().toISOString() },
      ],
    });
    console.log(`   Tx: https://stellar.expert/explorer/testnet/tx/${txHash}`);

    const paid = await getPaidInsight({ paymentTxHash: txHash, payTo: pub });
    console.log(`   Insight: "${paid.insight}"`);
    console.log(`   Fee charged: ${paid.feeChargedStroops} stroops\n`);
    rec.acts = [
      {
        kind: "payment",
        amount: X402_PRICE,
        destination: pub,
        txHash,
        feeChargedStroops: paid.feeChargedStroops,
      },
      {
        kind: "manageData",
        dataKey: IDENTITY_KEY,
        dataValue: IDENTITY_VALUE,
        txHash,
        feeChargedStroops: paid.feeChargedStroops,
      },
    ];
    rec.x402.receiptTx = txHash;
    return txHash;
  }
}

/** Final balance check + accounting record. */
async function closeLoop(pub: string, rec: RunRecord): Promise<void> {
  const final = await getBalance(pub);
  rec.balanceAfter = final;
  if (final !== null && xlmToStroops(final) < xlmToStroops(MIN_RUN_BALANCE_XLM)) {
    throw new ConfigError(`post-act balance ${final} XLM below minimum — halting`);
  }
  rec.result = "ok";
  appendRunRecord(rec);
  console.log(
    `\n✅ Done. ${pub.slice(0, PUBLIC_KEY_PREVIEW_LEN)}… holds ${final ?? "(unknown)"} XLM.`,
  );
  console.log("   Loop closed: Observe > Reason > Act.");
}

/** True when the fee collar trips (caller degrades to observe-only). */
async function checkFeeCollar(rec: RunRecord): Promise<boolean> {
  const mode = await getNetworkFeeMode();
  if (!feeCollarTripped(mode, FEE_REFERENCE_STROOPS, FEE_COLLAR_MULTIPLE)) return false;
  console.log(
    `🛟 Fee collar tripped (mode ${mode.toString()} stroops > ${FEE_COLLAR_MULTIPLE}× base) — observe-only, no writes.`,
  );
  rec.result = "degraded";
  appendRunRecord(rec);
  return true;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  console.log("🤖 tiny-onchain-agent-template (Stellar testnet) — Observe > Reason > Act");
  console.log(dryRun ? "   🧪 DRY-RUN: reads only, zero writes (no fund, no tx)\n" : "");

  assertTestnetConfig();
  const { kp, ephemeral } = loadKeypair();
  if (ephemeral) console.log("   (ephemeral mode: secret kept in memory only, never logged)\n");
  const pub = kp.publicKey();

  // Public key only, never the secret.
  const rec: RunRecord = {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    network: "testnet",
    mode: dryRun ? "dry-run" : "live",
    account: pub,
    balanceBefore: null,
    balanceAfter: null,
    acts: [],
    x402: { price: X402_PRICE, receiptTx: null },
    result: "error",
  };
  currentRun = rec;

  if ((await observe(pub, dryRun, rec)) === null) return;
  if (!dryRun && (await checkFeeCollar(rec))) return;
  if ((await reasonAndAct(pub, kp.secret(), dryRun, rec)) === null) return;
  await closeLoop(pub, rec);
}

main().catch((err: unknown) => {
  if (currentRun) {
    currentRun.error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    appendRunRecord(currentRun); // forensic trail survives failures too
  }
  console.error(
    "❌ Agent failed:",
    err instanceof Error ? `${err.name}: ${err.message}` : String(err),
  );
  process.exit(exitCodeOf(err));
});
