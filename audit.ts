// Append-only JSONL accounting log (public key only, never throws).
import { appendFileSync } from "node:fs";

/** Owner-only file mode for the log. */
const LOG_FILE_MODE = 0o600;

export interface ActRecord {
  kind: "payment" | "manageData";
  amount?: string;
  destination?: string;
  dataKey?: string;
  dataValue?: string;
  txHash?: string;
  /** Metered fee of the settling tx, in stroops. */
  feeChargedStroops?: string;
}

export interface RunRecord {
  /** Bump on breaking field changes. */
  schemaVersion: 1;
  ts: string;
  network: "testnet";
  mode: "live" | "dry-run";
  account: string;
  balanceBefore: string | null;
  balanceAfter: string | null;
  acts: ActRecord[];
  x402: { price: string; receiptTx: string | null };
  result: "ok" | "error" | "degraded";
  error?: string;
}

export function ledgerLogPath(): string {
  return process.env.LEDGER_LOG_PATH ?? "ledger-log.jsonl";
}

export function appendRunRecord(rec: RunRecord): void {
  try {
    appendFileSync(ledgerLogPath(), `${JSON.stringify(rec)}\n`, { mode: LOG_FILE_MODE });
  } catch (err) {
    console.warn(
      `⚠️  could not append accounting log: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
