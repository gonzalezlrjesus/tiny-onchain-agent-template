// Typed errors with stable numeric codes (1000–3402): ConfigError = exit 2, rest = exit 3.

/** Process exit codes. */
export enum ExitCode {
  Config = 2,
  Network = 3,
}

/** Documented error codes. */
export enum ErrorCode {
  Config = 1000,
  InvalidAddress = 1001,
  InvalidAmount = 1002,
  Network = 2000,
  Transaction = 3000,
  PaymentVerification = 3001,
  PaymentRequired = 3402,
}

/** Logged key prefix width (full values never hit logs). */
const LOGGED_KEY_CHARS = 12;

export class ConfigError extends Error {
  readonly exitCode = ExitCode.Config;
  readonly code: number = ErrorCode.Config;
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class InvalidAddressError extends ConfigError {
  readonly code = ErrorCode.InvalidAddress;
  constructor(label: string, value: string) {
    super(`Invalid Stellar address in ${label}: "${value.slice(0, LOGGED_KEY_CHARS)}…"`);
    this.name = "InvalidAddressError";
  }
}

export class InvalidAmountError extends ConfigError {
  readonly code = ErrorCode.InvalidAmount;
  constructor(value: string, reason: string) {
    super(`Invalid amount "${value}": ${reason}`);
    this.name = "InvalidAmountError";
  }
}

export class NetworkError extends Error {
  readonly exitCode = ExitCode.Network;
  readonly code = ErrorCode.Network;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "NetworkError";
  }
}

export class TransactionError extends Error {
  readonly exitCode = ExitCode.Network;
  readonly code = ErrorCode.Transaction;
  constructor(message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = "TransactionError";
  }
}

export class PaymentVerificationError extends Error {
  readonly exitCode = ExitCode.Network;
  readonly code = ErrorCode.PaymentVerification;
  constructor(message: string) {
    super(message);
    this.name = "PaymentVerificationError";
  }
}

export function exitCodeOf(err: unknown): number {
  if (err instanceof ConfigError) return err.exitCode;
  if (err instanceof NetworkError) return err.exitCode;
  if (err instanceof TransactionError) return err.exitCode;
  if (err instanceof PaymentVerificationError) return err.exitCode;
  return 1;
}
