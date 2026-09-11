// Network constants (single source of truth).
import { Networks } from "@stellar/stellar-sdk";

export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;

/** Hard cap per payment (XLM). */
export const MAX_PAYMENT_XLM = "5";

/** Refuse acts when the live fee exceeds MULTIPLE × REFERENCE. */
export const FEE_REFERENCE_STROOPS = 100n; // protocol base fee
export const FEE_COLLAR_MULTIPLE = 10;

/** Stellar protocol limits. */
export const TX_TIMEOUT_SECS = 30;
export const MEMO_TEXT_MAX_LENGTH = 28;
export const DATA_ENTRY_MAX_BYTES = 64;
export const XLM_DECIMAL_PLACES = 7;

/** Max age of a redeemable receipt, seconds. */
export const RECEIPT_MAX_AGE_SEC = 3600;

/** Truncated key/hash widths for human output. */
export const PUBLIC_KEY_PREVIEW_LEN = 8;
export const TX_HASH_PREVIEW_LEN = 12;
export const TX_HASH_DEBUG_PREVIEW_LEN = 16;
