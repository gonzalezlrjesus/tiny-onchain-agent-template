// Pure validation + stroop-exact math (no network, no side effects).
import { Networks, StrKey } from "@stellar/stellar-sdk";
import {
  DATA_ENTRY_MAX_BYTES,
  HORIZON_URL,
  MAX_PAYMENT_XLM,
  MEMO_TEXT_MAX_LENGTH,
  NETWORK_PASSPHRASE,
  XLM_DECIMAL_PLACES,
} from "./config.js";
import {
  ConfigError,
  InvalidAddressError,
  InvalidAmountError,
  PaymentVerificationError,
} from "./errors.js";

/** 1 XLM = 10_000_000 stroops. */
const STROOPS_PER_XLM = 10_000_000n;
const NO_STROOPS = 0n;
const MS_PER_SECOND = 1000;

/** Fail-closed unless every network parameter points at testnet. */
export function assertTestnetConfig(opts?: { horizonUrl?: string; passphrase?: string }): void {
  const url = opts?.horizonUrl ?? HORIZON_URL;
  const pass = opts?.passphrase ?? NETWORK_PASSPHRASE;
  if (!url.includes("testnet")) {
    throw new ConfigError(`refusing non-testnet Horizon URL: ${url} (Cat 15 network bounding)`);
  }
  if (pass !== (Networks.TESTNET as string)) {
    throw new ConfigError("refusing non-testnet network passphrase (Cat 15 network bounding)");
  }
}

export function assertValidPublicKey(label: string, value: string): void {
  if (!StrKey.isValidEd25519PublicKey(value)) {
    throw new InvalidAddressError(label, value);
  }
}

/** Decimal XLM string: positive, ≤7 decimals, ≤ cap. No floats. */
export function assertValidAmount(value: string, cap: string = MAX_PAYMENT_XLM): void {
  if (!/^\d+(\.\d{1,7})?$/.test(value)) {
    throw new InvalidAmountError(value, "expected decimal string with ≤7 decimals");
  }
  const stroops = xlmToStroops(value);
  if (stroops <= NO_STROOPS) throw new InvalidAmountError(value, "must be > 0");
  if (stroops > xlmToStroops(cap)) {
    throw new InvalidAmountError(value, `exceeds cap of ${cap} XLM`);
  }
}

export function xlmToStroops(xlm: string): bigint {
  // All-digit operands make BigInt total here; garbage fails the regex above.
  if (!/^\d+(\.\d+)?$/.test(xlm)) {
    throw new InvalidAmountError(xlm, "expected decimal string");
  }
  const [whole, frac = ""] = xlm.split(".");
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(frac.padEnd(XLM_DECIMAL_PLACES, "0"));
}

/** Canonical XLM string from stroops (trims trailing zeros). */
export function stroopsToXlm(stroops: bigint): string {
  if (stroops < NO_STROOPS) throw new ConfigError("stroops must be >= 0");
  const whole = stroops / STROOPS_PER_XLM;
  const frac = (stroops % STROOPS_PER_XLM)
    .toString()
    .padStart(XLM_DECIMAL_PLACES, "0")
    .replace(/0+$/, "");
  return frac === "" ? whole.toString() : `${whole.toString()}.${frac}`;
}

export function assertValidMemo(memo: string): void {
  if (memo.length > MEMO_TEXT_MAX_LENGTH)
    throw new ConfigError(`memo exceeds ${MEMO_TEXT_MAX_LENGTH} chars (Memo.text limit)`);
}

export function assertValidDataEntry(key: string, value: string): void {
  // byteLength defaults to utf8 — the default is the spec here, no literal to mutate.
  const nameBytes = Buffer.byteLength(key);
  const valueBytes = Buffer.byteLength(value);
  if (nameBytes === 0 || nameBytes > DATA_ENTRY_MAX_BYTES) {
    throw new ConfigError(
      `data entry name must be 1–${DATA_ENTRY_MAX_BYTES} bytes (got ${nameBytes})`,
    );
  }
  if (valueBytes > DATA_ENTRY_MAX_BYTES) {
    throw new ConfigError(
      `data entry value must be ≤${DATA_ENTRY_MAX_BYTES} bytes (got ${valueBytes})`,
    );
  }
}

/** Reject ledger timestamps older than maxAgeSec (bounds replay). */
export function assertFreshTimestamp(createdAtIso: string, nowMs: number, maxAgeSec: number): void {
  const timestampMs = Date.parse(createdAtIso);
  if (Number.isNaN(timestampMs)) {
    throw new PaymentVerificationError(`unparseable ledger timestamp: "${createdAtIso}"`);
  }
  const ageSec = (nowMs - timestampMs) / MS_PER_SECOND;
  if (ageSec > maxAgeSec) {
    throw new PaymentVerificationError(
      `stale receipt: ${Math.floor(ageSec)}s old, max ${maxAgeSec}s (replay window exceeded)`,
    );
  }
}

/** True when the live fee exceeds multiple × reference (boundary inclusive). */
export function feeCollarTripped(
  spotStroops: bigint,
  referenceStroops: bigint,
  multiple: number,
): boolean {
  return spotStroops > referenceStroops * BigInt(multiple);
}
