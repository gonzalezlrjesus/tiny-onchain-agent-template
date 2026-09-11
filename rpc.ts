// Horizon Testnet API wrapper.
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { ConfigError, NetworkError, PaymentVerificationError, TransactionError } from "./errors.js";
import {
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  PUBLIC_KEY_PREVIEW_LEN,
  RECEIPT_MAX_AGE_SEC,
  TX_HASH_DEBUG_PREVIEW_LEN,
  TX_HASH_PREVIEW_LEN,
  TX_TIMEOUT_SECS,
} from "./config.js";
import {
  assertFreshTimestamp,
  assertValidAmount,
  assertValidDataEntry,
  assertValidMemo,
  assertValidPublicKey,
  xlmToStroops,
} from "./validate.js";

/** The only status that maps to a legitimate empty state. */
const HTTP_NOT_FOUND = 404;
/** Retry backoff: base delay × factor^(attempt-1). */
const RETRY_BASE_DELAY_MS = 500;
const RETRY_BACKOFF_FACTOR = 2;
const DEFAULT_RETRIES = 3;

let cachedServer: Horizon.Server | null = null;

export function getServer(): Horizon.Server {
  cachedServer ??= new Horizon.Server(HORIZON_URL);
  return cachedServer;
}

function horizonStatus(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const response: unknown = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return undefined;
  const status: unknown = (response as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function horizonErrorName(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const errorName: unknown = (err as { name?: unknown }).name;
  return typeof errorName === "string" ? errorName : "";
}

function isNotFoundError(err: unknown): boolean {
  if (horizonStatus(err) === HTTP_NOT_FOUND) return true;
  return horizonErrorName(err).includes("NotFound");
}

/** Retry transient failures only. */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ConfigError) throw err;
      if (isNotFoundError(err)) throw err;
      last = err;
      if (attempt === retries) break;
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** (attempt - 1)),
      );
    }
  }
  throw new NetworkError(`${label} failed after ${retries} attempts`, { cause: last });
}

// Reads

/** XLM balance, or null if the account is unfunded. */
export async function getBalance(publicKey: string): Promise<string | null> {
  assertValidPublicKey("getBalance.publicKey", publicKey);
  try {
    const account = await withRetry("loadAccount", () => getServer().loadAccount(publicKey));
    const native = account.balances.find((entry) => entry.asset_type === "native");
    return native?.balance ?? "0";
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/** Fund via Friendbot (testnet only). True if funded now. */
export async function ensureFunded(publicKey: string): Promise<boolean> {
  assertValidPublicKey("ensureFunded.publicKey", publicKey);
  const balance = await getBalance(publicKey);
  if (balance !== null) return false;
  console.log(`  🍼 Funding ${publicKey.slice(0, PUBLIC_KEY_PREVIEW_LEN)}… via Friendbot…`);
  await withRetry("friendbot", () => getServer().friendbot(publicKey).call());
  return true;
}

// Writes

function keypairFromSecret(secret: string): Keypair {
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new ConfigError("SECRET_KEY is malformed (expected StrKey secret starting with 'S')");
  }
}

async function submitSigned(
  source: Keypair,
  tx: ReturnType<TransactionBuilder["build"]>,
  label: string,
): Promise<string> {
  tx.sign(source);
  let res;
  try {
    res = await withRetry(`submitTransaction(${label})`, () => getServer().submitTransaction(tx));
  } catch (err) {
    throw new TransactionError(`${label} submission failed`, { cause: err });
  }
  if (!res.successful) throw new TransactionError(`${label} rejected onchain: ${res.hash}`);
  return res.hash;
}

async function loadSource(
  secret: string,
): Promise<{ source: Keypair; account: Awaited<ReturnType<Horizon.Server["loadAccount"]>> }> {
  const source = keypairFromSecret(secret);
  const account = await withRetry("loadAccount(source)", () =>
    getServer().loadAccount(source.publicKey()),
  );
  return { source, account };
}

function baseTx(account: Awaited<ReturnType<Horizon.Server["loadAccount"]>>): TransactionBuilder {
  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
}

/** Native XLM payment. */
export async function sendPayment(
  secret: string,
  destination: string,
  amount: string,
  memo = "tiny-agent",
): Promise<string> {
  assertValidPublicKey("sendPayment.destination", destination);
  assertValidAmount(amount);
  assertValidMemo(memo);
  const { source, account } = await loadSource(secret);

  const tx = baseTx(account)
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount }))
    .addMemo(Memo.text(memo))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  return submitSigned(source, tx, "payment");
}

/** Data entry on the account (onchain identity). */
export async function setDataEntry(secret: string, key: string, value: string): Promise<string> {
  assertValidDataEntry(key, value);
  const { source, account } = await loadSource(secret);

  const tx = baseTx(account)
    .addOperation(Operation.manageData({ name: key, value }))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  return submitSigned(source, tx, "manageData");
}

/** Fee payment + identity writes in ONE tx (all ops settle or none). */
export async function executeActs(
  secret: string,
  opts: {
    destination: string;
    amount: string;
    memo?: string;
    dataEntries: { key: string; value: string }[];
  },
): Promise<string> {
  assertValidPublicKey("executeActs.destination", opts.destination);
  assertValidAmount(opts.amount);
  assertValidMemo(opts.memo ?? "tiny-agent");
  for (const entry of opts.dataEntries) assertValidDataEntry(entry.key, entry.value);
  const { source, account } = await loadSource(secret);

  let builder = baseTx(account).addOperation(
    Operation.payment({
      destination: opts.destination,
      asset: Asset.native(),
      amount: opts.amount,
    }),
  );
  for (const entry of opts.dataEntries) {
    builder = builder.addOperation(Operation.manageData({ name: entry.key, value: entry.value }));
  }
  const tx = builder
    .addMemo(Memo.text(opts.memo ?? "tiny-agent"))
    .setTimeout(TX_TIMEOUT_SECS)
    .build();

  return submitSigned(source, tx, "atomic-acts(payment+manageData)");
}

/** Live base-fee mode in stroops (fee-stats oracle for the collar). */ export async function getNetworkFeeMode(): Promise<bigint> {
  const stats = await withRetry("feeStats", () => getServer().feeStats());
  try {
    return BigInt(stats.fee_charged.mode);
  } catch {
    throw new NetworkError("fee stats unreadable: mode fee is not numeric");
  }
}

// Settlement verification

/** Payment settled onchain: successful + fresh + exact native amount + destination. */
export async function verifyPaymentTx(
  hash: string,
  opts: { expectDestination: string; expectAmount: string; maxAgeSec?: number },
): Promise<{ feeChargedStroops: string }> {
  assertValidPublicKey("verifyPaymentTx.expectDestination", opts.expectDestination);
  assertValidAmount(opts.expectAmount);
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new PaymentVerificationError(
      `malformed tx hash: "${hash.slice(0, TX_HASH_DEBUG_PREVIEW_LEN)}…"`,
    );
  }

  let tx;
  try {
    tx = await withRetry("getTransaction", () =>
      getServer().transactions().transaction(hash).call(),
    );
  } catch (err) {
    if (isNotFoundError(err))
      throw new PaymentVerificationError(
        `tx not found on ledger: ${hash.slice(0, TX_HASH_PREVIEW_LEN)}…`,
      );
    throw err;
  }
  if (!tx.successful)
    throw new PaymentVerificationError(`tx failed onchain: ${hash.slice(0, TX_HASH_PREVIEW_LEN)}…`);
  assertFreshTimestamp(tx.created_at, Date.now(), opts.maxAgeSec ?? RECEIPT_MAX_AGE_SEC);

  const ops = await withRetry("getOperations", () =>
    getServer().operations().forTransaction(hash).call(),
  );
  // Horizon pads amounts to 7 decimals — compare in stroops.
  const expectStroops = xlmToStroops(opts.expectAmount);
  const match = ops.records.some((record) => {
    if (record.type !== Horizon.HorizonApi.OperationResponseType.payment) return false;
    const raw: unknown = record;
    if (typeof raw !== "object" || raw === null) return false;
    const {
      to,
      amount,
      asset_type: assetType,
    } = raw as {
      to?: unknown;
      amount?: unknown;
      asset_type?: unknown;
    };
    if (to !== opts.expectDestination) return false;
    if (assetType !== "native" || typeof amount !== "string") return false;
    try {
      return xlmToStroops(amount) === expectStroops;
    } catch {
      return false;
    }
  });
  if (!match) {
    throw new PaymentVerificationError(
      `tx ${hash.slice(0, TX_HASH_PREVIEW_LEN)}… contains no native payment of ${opts.expectAmount} XLM to ${opts.expectDestination.slice(0, PUBLIC_KEY_PREVIEW_LEN)}…`,
    );
  }
  return { feeChargedStroops: String(tx.fee_charged) };
}
