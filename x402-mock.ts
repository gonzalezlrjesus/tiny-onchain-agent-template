// Pay-per-request settled in testnet XLM, verified on Horizon.
import { verifyPaymentTx } from "./rpc.js";
import { PUBLIC_KEY_PREVIEW_LEN } from "./config.js";
import { ErrorCode, PaymentVerificationError } from "./errors.js";

export const X402_PRICE = "0.1"; // XLM (testnet)

/** Thrown instead of serving content. */
export class PaymentRequiredError extends Error {
  readonly code = ErrorCode.PaymentRequired;
  constructor(
    readonly payTo: string,
    readonly amount: string,
    message: string,
  ) {
    super(message);
    this.name = "PaymentRequiredError";
  }
}

export function isPaymentRequired(err: unknown): err is PaymentRequiredError {
  return err instanceof PaymentRequiredError;
}

/** One-time receipts per process. */
const usedReceipts = new Set<string>();

/** Throws if the hash was already redeemed, else marks it. */
export function checkAndMarkReceipt(used: Set<string>, hash: string): void {
  if (used.has(hash.toLowerCase())) {
    throw new PaymentVerificationError("receipt already redeemed (replay rejected)");
  }
  used.add(hash.toLowerCase());
}

export async function getPaidInsight(opts: {
  paymentTxHash?: string;
  payTo: string;
}): Promise<{ insight: string; txHash: string; feeChargedStroops: string }> {
  if (!opts.paymentTxHash) {
    throw new PaymentRequiredError(
      opts.payTo,
      X402_PRICE,
      `Payment required: send ${X402_PRICE} XLM (testnet) to ${opts.payTo.slice(0, PUBLIC_KEY_PREVIEW_LEN)}… then retry with paymentTxHash`,
    );
  }
  const { paymentTxHash: hash, payTo } = opts;
  const { feeChargedStroops } = await verifyPaymentTx(hash, {
    expectDestination: payTo,
    expectAmount: X402_PRICE,
  });
  // Mark after verify so transient failures stay retryable.
  checkAndMarkReceipt(usedReceipts, hash);
  return {
    insight: "Testnet is calm: fees ~100 stroops, ledger closes ~5s. Good time to act.",
    txHash: hash,
    feeChargedStroops,
  };
}
