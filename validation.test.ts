// Offline tests: no network (network paths are verified live via agent.ts).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { Keypair, Networks } from "@stellar/stellar-sdk";
import {
  assertFreshTimestamp,
  assertTestnetConfig,
  assertValidAmount,
  assertValidDataEntry,
  assertValidMemo,
  assertValidPublicKey,
  feeCollarTripped,
  stroopsToXlm,
  xlmToStroops,
} from "./validate.js";
import { appendRunRecord, ledgerLogPath, type RunRecord } from "./audit.js";
import {
  ConfigError,
  InvalidAddressError,
  InvalidAmountError,
  NetworkError,
  PaymentVerificationError,
  TransactionError,
  exitCodeOf,
} from "./errors.js";
import { checkAndMarkReceipt, getPaidInsight, isPaymentRequired } from "./x402-mock.js";

/** Deterministic PRNG (xorshift64): dependency-free reproducible fuzz, no flaky seeds. */
function xorshift64(seed: bigint): () => bigint {
  let s = seed;
  return () => {
    s ^= s << 13n;
    s ^= s >> 7n;
    s ^= s << 17n;
    return s & ((1n << 63n) - 1n);
  };
}

describe("amount validation (stroop-exact, capped)", () => {
  it("accepts 0.1 and converts to 1_000_000 stroops", () => {
    assertValidAmount("0.1");
    assert.equal(xlmToStroops("0.1"), 1_000_000n);
  });
  it("rejects >7 decimals, zero, over-cap, garbage", () => {
    for (const bad of ["0.00000001", "0", "999999", "abc", "-1", "1.2.3"]) {
      assert.throws(() => {
        assertValidAmount(bad);
      }, ConfigError);
    }
  });
  it("anchors hold: affixes around a valid amount still throw", () => {
    for (const bad of ["x0.1", "0.1x", " 0.1", "0.1 ", "x0.1x"]) {
      assert.throws(
        () => {
          assertValidAmount(bad);
        },
        // Proves the anchored format regex fired, not the stroop guard.
        (e: unknown) => e instanceof ConfigError && e.message.includes("≤7 decimals"),
      );
    }
  });
  it("each rejection names its reason", () => {
    assert.throws(
      () => {
        assertValidAmount("0");
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("must be > 0"),
    );
    assert.throws(
      () => {
        assertValidAmount("99");
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("exceeds cap"),
    );
    assert.throws(
      () => {
        assertValidAmount("0.00000001");
      },
      // 8 decimals die at the format guard (proves the regex branch fired).
      (e: unknown) => e instanceof ConfigError && e.message.includes("≤7 decimals"),
    );
  });
  it("cap is inclusive: exactly 5 XLM passes", () => {
    assertValidAmount("5");
  });
});

describe("amount rejection reasons (which guard fired)", () => {
  it("memo boundary: 28 ok, 29 throws", () => {
    assertValidMemo("m".repeat(28));
    assert.throws(
      () => {
        assertValidMemo("m".repeat(29));
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("28 chars"),
    );
  });
  it("data-entry boundary: 64 bytes ok, 65 throws, empty name throws", () => {
    assertValidDataEntry("k".repeat(64), "v".repeat(64));
    assert.throws(
      () => {
        assertValidDataEntry("k".repeat(65), "v");
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("1–64 bytes"),
    );
    assert.throws(
      () => {
        assertValidDataEntry("k", "v".repeat(65));
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("≤64 bytes"),
    );
    assert.throws(() => {
      assertValidDataEntry("", "v");
    }, ConfigError);
  });
  it("stroopsToXlm rejects negatives", () => {
    assert.throws(
      () => {
        stroopsToXlm(-1n);
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes(">= 0"),
    );
  });
  it("xlmToStroops names the decimal guard", () => {
    assert.throws(
      () => {
        xlmToStroops("abc");
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("decimal"),
    );
  });
});

describe("error taxonomy (names + messages, not just types)", () => {
  it("every class carries its name", () => {
    assert.equal(new ConfigError("m").name, "ConfigError");
    assert.equal(new InvalidAddressError("lbl", "GXYZ").name, "InvalidAddressError");
    assert.equal(new InvalidAmountError("v", "r").name, "InvalidAmountError");
    assert.equal(new NetworkError("m").name, "NetworkError");
    assert.equal(new TransactionError("m").name, "TransactionError");
    assert.equal(new PaymentVerificationError("m").name, "PaymentVerificationError");
  });
  it("every class carries a unique documented code", () => {
    const codes = [
      new ConfigError("m").code,
      new InvalidAddressError("l", "v").code,
      new InvalidAmountError("v", "r").code,
      new NetworkError("m").code,
      new TransactionError("m").code,
      new PaymentVerificationError("m").code,
    ];
    assert.deepEqual(codes, [1000, 1001, 1002, 2000, 3000, 3001]);
  });
  it("messages embed context (label, value, reason)", () => {
    const addr = new InvalidAddressError("lbl", "GXYZ");
    assert.ok(addr.message.includes("lbl") && addr.message.includes("Invalid Stellar address"));
    const amt = new InvalidAmountError("vv", "rr");
    assert.ok(amt.message.includes("vv") && amt.message.includes("rr"));
    // Long values are truncated, full keys never hit logs.
    assert.ok(!new InvalidAddressError("l", "G".repeat(56)).message.includes("G".repeat(56)));
  });
});

describe("address validation", () => {
  it("accepts a real pubkey, rejects garbage", () => {
    assertValidPublicKey("t", Keypair.random().publicKey());
    assert.throws(() => {
      assertValidPublicKey("t", "GNOTVALID");
    }, ConfigError);
  });
});

describe("x402 flow (offline)", () => {
  it("throws 402 without receipt, with terms attached", async () => {
    const payTo = Keypair.random().publicKey();
    await assert.rejects(getPaidInsight({ payTo }), (e: unknown) => {
      assert.ok(isPaymentRequired(e));
      assert.equal(e.amount, "0.1");
      assert.equal(e.payTo, payTo);
      assert.equal(e.name, "PaymentRequiredError");
      assert.equal(e.code, 3402);
      assert.ok(e.message.includes("Payment required"));
      // 402 messages carry truncated addresses only.
      assert.ok(!e.message.includes(payTo) && e.message.includes(payTo.slice(0, 8)));
      return true;
    });
    assert.equal(isPaymentRequired(new Error("nope")), false);
  });
  it("rejects malformed hash without touching network", async () => {
    const payTo = Keypair.random().publicKey();
    await assert.rejects(
      getPaidInsight({ payTo, paymentTxHash: "notahash" }),
      PaymentVerificationError,
    );
  });
});

describe("exit codes", () => {
  it("config=2, network/tx=3, unknown=1", () => {
    assert.equal(exitCodeOf(new ConfigError("x")), 2);
    assert.equal(exitCodeOf(new NetworkError("x")), 3);
    assert.equal(exitCodeOf(new TransactionError("x")), 3);
    assert.equal(exitCodeOf(new PaymentVerificationError("x")), 3);
    assert.equal(exitCodeOf(new Error("x")), 1);
  });
});

describe("receipt replay guard (pure, offline)", () => {
  it("first mark passes, second throws, case-insensitive", () => {
    const used = new Set<string>();
    const hash = "A".repeat(64);
    checkAndMarkReceipt(used, hash);
    assert.throws(
      () => {
        checkAndMarkReceipt(used, hash.toLowerCase());
      },
      (e: unknown) => e instanceof PaymentVerificationError && e.message.includes("replay"),
    );
  });
});

/** Shared fixture: dry-run record skeleton (kills test-code duplication). */
function sampleRecord(pub: string): RunRecord {
  return {
    schemaVersion: 1,
    ts: new Date().toISOString(),
    network: "testnet",
    mode: "dry-run",
    account: pub,
    balanceBefore: null,
    balanceAfter: null,
    acts: [],
    x402: { price: "0.1", receiptTx: null },
    result: "ok",
  };
}

describe("accounting log failure path", () => {
  it("unwritable log warns but never throws", () => {
    process.env.LEDGER_LOG_PATH = tmpdir(); // a directory, so append fails
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (msg: string) => {
      warnings.push(msg);
    };
    try {
      assert.doesNotThrow(() => {
        appendRunRecord(sampleRecord(Keypair.random().publicKey()));
      });
    } finally {
      console.warn = origWarn;
      delete process.env.LEDGER_LOG_PATH;
    }
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("accounting log"));
  });
});

describe("receipt freshness (SEP-40 mindset, offline)", () => {
  const NOW = Date.parse("2026-09-11T12:00:00.000Z");
  it("fresh timestamps pass, stale ones throw", () => {
    assertFreshTimestamp("2026-09-11T11:59:00.000Z", NOW, 3600);
    assert.throws(
      () => {
        assertFreshTimestamp("2026-09-11T10:00:00.000Z", NOW, 3600);
      },
      (e: unknown) => e instanceof PaymentVerificationError && e.message.includes("stale"),
    );
  });
  it("boundary is inclusive, future skew tolerated, garbage rejected", () => {
    assertFreshTimestamp("2026-09-11T11:00:00.000Z", NOW, 3600); // exact boundary
    assertFreshTimestamp("2026-09-11T12:05:00.000Z", NOW, 3600); // clock skew
    assert.throws(
      () => {
        assertFreshTimestamp("not-a-time", NOW, 3600);
      },
      (e: unknown) => e instanceof PaymentVerificationError && e.message.includes("unparseable"),
    );
  });
});

describe("fee collar (Cat 18 NAV-collar analogue)", () => {
  it("trips above multiple × reference, boundary inclusive", () => {
    assert.equal(feeCollarTripped(100n, 100n, 10), false);
    assert.equal(feeCollarTripped(1000n, 100n, 10), false); // boundary inclusive
    assert.equal(feeCollarTripped(1001n, 100n, 10), true);
    assert.equal(feeCollarTripped(0n, 100n, 10), false);
  });
});

describe("network bounding (Cat 15)", () => {
  it("accepts testnet defaults", () => {
    assertTestnetConfig();
  });
  it("refuses mainnet URL / passphrase", () => {
    assert.throws(
      () => {
        assertTestnetConfig({ horizonUrl: "https://horizon.stellar.org" });
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("testnet"),
    );
    assert.throws(
      () => {
        assertTestnetConfig({ passphrase: Networks.PUBLIC });
      },
      (e: unknown) => e instanceof ConfigError && e.message.includes("passphrase"),
    );
  });
});

describe("accounting log (Cat 14+17)", () => {
  it("appends one valid JSON line, public key only", () => {
    const dir = mkdtempSync(join(tmpdir(), "tiny-agent-"));
    process.env.LEDGER_LOG_PATH = join(dir, "test.jsonl");
    const pub = Keypair.random().publicKey();
    appendRunRecord(sampleRecord(pub));
    const line = readFileSync(process.env.LEDGER_LOG_PATH, "utf8").trim();
    const rec = JSON.parse(line) as { account: string };
    assert.equal(rec.account, pub);
    assert.ok(!line.includes("SECRET"), "no secrets in log");
    delete process.env.LEDGER_LOG_PATH;
  });
  it("log lines end with newline and default path is ledger-log.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "tiny-agent-"));
    const path = join(dir, "nl.jsonl");
    process.env.LEDGER_LOG_PATH = path;
    const pub = Keypair.random().publicKey();
    appendRunRecord({
      schemaVersion: 1,
      ts: "2026-01-01T00:00:00.000Z",
      network: "testnet",
      mode: "live",
      account: pub,
      balanceBefore: "10",
      balanceAfter: "9",
      acts: [],
      x402: { price: "0.1", receiptTx: null },
      result: "ok",
    });
    delete process.env.LEDGER_LOG_PATH;
    const raw = readFileSync(path, "utf8");
    assert.ok(raw.endsWith("\n"), "append-only JSONL framing");
    assert.equal(ledgerLogPath(), "ledger-log.jsonl");
    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

describe("stroop-exact roundtrip (property-based, Cat 8)", () => {
  it("xlmToStroops(stroopsToXlm(s)) === s for 500 random values + edges", () => {
    const edges = [1n, 9n, 10_000_000n, 100_000_000n, 9_223_372_036_854_775_807n];
    const rand = xorshift64(0x2f6e2b1n);
    for (const s of [
      ...edges,
      ...Array.from({ length: 500 }, () => (rand() % 10_000_000_000_000_000n) + 1n),
    ]) {
      const back = xlmToStroops(stroopsToXlm(s));
      assert.equal(back, s, `roundtrip failed for ${s.toString()}`);
    }
  });
  it("canonical form trims zeros: 1_000_000 stroops -> '0.1'", () => {
    assert.equal(stroopsToXlm(1_000_000n), "0.1");
    assert.equal(stroopsToXlm(10_000_000n), "1");
    assert.equal(stroopsToXlm(0n), "0");
  });
  it("invariant: every canonical amount under cap passes assertValidAmount", () => {
    const rand = xorshift64(0x9e3779b9n);
    for (let i = 0; i < 200; i++) {
      const s = (rand() % 50_000_000n) + 1n; // (0, 5] XLM in stroops
      assertValidAmount(stroopsToXlm(s)); // must never throw
    }
  });
});

describe("input fuzz (cargo-fuzz mindset, deterministic seed)", () => {
  it("xlmToStroops on garbage throws ONLY ConfigError, never raw errors", () => {
    const garbage = [
      "abc",
      "",
      " ",
      "1.2.3",
      "--1",
      "NaN",
      "Infinity",
      "0x10",
      "1e5",
      "１２３",
      "0.1 ",
      " 0.1",
      "\0",
      `S${"A".repeat(55)}`,
      ".",
      ".5",
      "5.",
      "-",
      "+",
      "999999999999999999999999.9999999!",
    ];
    // Mutated byte soup: deterministic PRNG over printable bytes
    const rand = xorshift64(0x12345678n);
    const randByte = (): number => Number(rand() & 0x5fn) + 32;
    for (let i = 0; i < 300; i++) {
      const len = 1 + (randByte() % 12);
      garbage.push(String.fromCharCode(...Array.from({ length: len }, randByte)));
    }
    for (const g of garbage) {
      try {
        xlmToStroops(g);
      } catch (e) {
        assert.ok(
          e instanceof ConfigError,
          `input ${JSON.stringify(g)} leaked ${(e as Error).name}`,
        );
      }
    }
  });
});
