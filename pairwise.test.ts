// Greedy all-pairs covering array over the offline validation matrix.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { assertValidAmount, assertValidDataEntry, assertValidPublicKey } from "./validate.js";
import { ConfigError } from "./errors.js";

interface Level {
  label: string;
  sample: () => string;
  throws: boolean;
}

/** Every value-pair of every param-pair appears at least once. */
export function pairwise(nLevels: number[]): number[][] {
  if (nLevels.length === 0) return [];
  if (nLevels.some((n) => n < 1)) throw new Error("pairwise: empty param domain");
  if (nLevels.length === 1) return Array.from({ length: nLevels[0] }, (_, a) => [a]);
  const rows: number[][] = [];
  for (let a = 0; a < nLevels[0]; a++) {
    for (let b = 0; b < nLevels[1]; b++) rows.push([a, b]);
  }
  for (let k = 2; k < nLevels.length; k++) {
    const uncovered = missingPairs(nLevels.slice(0, k + 1), rows);
    assignToExistingRows(nLevels, rows, k, uncovered);
    appendRowsForLeftovers(rows, k, uncovered);
  }
  return rows;
}

/** Best param-k value for each existing row. */
function assignToExistingRows(
  nLevels: number[],
  rows: number[][],
  k: number,
  uncovered: Set<string>,
): void {
  for (const row of rows) {
    let best = 0;
    let bestGain = -1;
    for (let v = 0; v < nLevels[k]; v++) {
      row[k] = v;
      const gain = countNewlyCovered(rows, row, k);
      if (gain > bestGain) {
        bestGain = gain;
        best = v;
      }
    }
    row[k] = best;
    for (let j = 0; j < k; j++) uncovered.delete(pairKey(j, row[j], k, best));
  }
}

const PAIR_KEY_RE = /^(\d+):(\d+)\|(\d+):(\d+)$/;

/** One new row per leftover pair (pair + zeros elsewhere). */
function appendRowsForLeftovers(rows: number[][], k: number, uncovered: Set<string>): void {
  for (const key of [...uncovered]) {
    const m = PAIR_KEY_RE.exec(key);
    if (!m) continue;
    const [, js, av, ks, bv] = m;
    const row = new Array<number>(k + 1).fill(0);
    row[Number(js)] = Number(av);
    row[Number(ks)] = Number(bv);
    rows.push(row);
    for (let j = 0; j < k; j++) uncovered.delete(pairKey(j, row[j], k, row[k]));
  }
}

function pairKey(i: number, a: number, j: number, b: number): string {
  return `${i}:${a}|${j}:${b}`;
}

/** Pairs not yet present in rows. */
function missingPairs(nLevels: number[], rows: number[][]): Set<string> {
  const missing = new Set<string>();
  for (let i = 0; i < nLevels.length; i++) {
    for (let j = i + 1; j < nLevels.length; j++) {
      for (let a = 0; a < nLevels[i]; a++) {
        for (let b = 0; b < nLevels[j]; b++) {
          const covered = rows.some((r) => r.length > j && r[i] === a && r[j] === b);
          if (!covered) missing.add(pairKey(i, a, j, b));
        }
      }
    }
  }
  return missing;
}

/** Pairs the row would newly cover. */
function countNewlyCovered(rows: number[][], row: number[], k: number): number {
  let gain = 0;
  for (let j = 0; j < k; j++) {
    const already = rows.some(
      (r) => r !== row && r.length > k && r[j] === row[j] && r[k] === row[k],
    );
    if (!already) gain += 1;
  }
  return gain;
}

describe("pairwise generator (self-check)", () => {
  it("covers 100% of pairs on the validation matrix shape", () => {
    const rows = pairwise([6, 3, 3, 2]);
    assert.equal(missingPairs([6, 3, 3, 2], rows).size, 0);
    assert.ok(rows.length < 6 * 3 * 3 * 2, `no reduction: ${rows.length} rows`);
  });
  it("handles edge shapes", () => {
    assert.deepEqual(pairwise([]), []);
    assert.deepEqual(pairwise([3]), [[0], [1], [2]]);
    assert.equal(missingPairs([2, 2, 2], pairwise([2, 2, 2])).size, 0);
  });
});

describe("validation matrix (pairwise over validity classes)", () => {
  const validPub = Keypair.random().publicKey();
  const amounts: Level[] = [
    { label: "valid", sample: () => "0.1", throws: false },
    { label: "zero", sample: () => "0", throws: true },
    { label: "bad-format", sample: () => "abc", throws: true },
    { label: "over-cap", sample: () => "99", throws: true },
    { label: "negative", sample: () => "-1", throws: true },
    { label: "8-decimals", sample: () => "0.00000001", throws: true },
  ];
  const addresses: Level[] = [
    { label: "valid", sample: () => validPub, throws: false },
    { label: "garbage", sample: () => "GNOTVALID", throws: true },
    { label: "empty", sample: () => "", throws: true },
  ];
  const dataKeys: Level[] = [
    { label: "valid", sample: () => "agent.ai.role", throws: false },
    { label: "empty", sample: () => "", throws: true },
    { label: "65-bytes", sample: () => "k".repeat(65), throws: true },
  ];
  const dataValues: Level[] = [
    { label: "valid", sample: () => "tiny-observe-reason-act", throws: false },
    { label: "65-bytes", sample: () => "v".repeat(65), throws: true },
  ];
  const params = [amounts, addresses, dataKeys, dataValues];

  it("every pairwise row behaves per oracle (offline, no network)", () => {
    const rows = pairwise(params.map((p) => p.length));
    for (const [ai, di, ki, vi] of rows) {
      const a = amounts[ai];
      const d = addresses[di];
      const k = dataKeys[ki];
      const v = dataValues[vi];
      const tag = `amount=${a.label} addr=${d.label} key=${k.label} val=${v.label}`;
      if (a.throws) {
        assert.throws(
          () => {
            assertValidAmount(a.sample());
          },
          ConfigError,
          tag,
        );
      } else {
        assertValidAmount(a.sample());
      }
      if (d.throws) {
        assert.throws(
          () => {
            assertValidPublicKey("pairwise", d.sample());
          },
          ConfigError,
          tag,
        );
      } else {
        assertValidPublicKey("pairwise", d.sample());
      }
      const keyThrows = k.throws || v.throws;
      if (keyThrows) {
        assert.throws(
          () => {
            assertValidDataEntry(k.sample(), v.sample());
          },
          ConfigError,
          tag,
        );
      } else {
        assertValidDataEntry(k.sample(), v.sample());
      }
    }
  });
});
