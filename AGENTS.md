# AGENTS.md

Tiny Observe > Reason > Act agent on **Stellar testnet**. TypeScript only.

## Commands (all green before commit)

```bash
npx tsx agent.ts            # live run (testnet)
npx tsx agent.ts --dry-run  # reads only, zero writes
npm test                    # vitest
npm run lint                # eslint strict + sonar + import-x
npm run typecheck           # tsc, no unused locals
npm run format:check        # prettier
npm run audit               # npm audit, high = 0
npm run duplicates          # jscpd, 0 clones
npm run mutate              # stryker, break 80 (pure units)
```

## Rules

- One atomic tx per run (`executeActs`): fee + identity writes settle together or not at all.
- Verify receipts on Horizon before serving paid content; mark one-time use after verify.
- Secrets never logged or committed. Testnet only (`assertTestnetConfig` fail-closes).
- No floats for money: stroop `BigInt` only. Errors typed (`errors.ts` codes 1000–3402).
- Pure logic in `validate.ts`, network I/O in `rpc.ts`. Never import `rpc` from `validate`.
- Comments: 1 line max, English. No `any`, no magic numbers, functions ≤80 lines.

## Done

Gates green + live (or `--dry-run`) verified + no secrets in `git status`.
