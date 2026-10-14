# Independent Concurrency Validation Experiment

A minimal, dependency-free Node.js experiment that demonstrates the
difference between a **non-atomic check-then-commit** authorization model
and an **atomic check-and-commit** model when two concurrent requests
each individually fit the remaining budget but together exceed the
cumulative authorization limit.

> **Scope note.** This is an independent engineering experiment. It does
> not use, import, or claim to have inspected any third-party repository
> or product. It does not establish that any real system is vulnerable.

## Scenario

| Parameter | Value |
|---|---:|
| Authorization limit | $10,000 |
| Previously consumed | $4,000 |
| Remaining budget | $6,000 |
| Request A | $4,000 |
| Request B | $4,000 |

Required invariant:

```
previously_consumed + total_successfully_committed_amount <= authorization_limit
```

Exactly one $4,000 request must succeed. Both succeeding ($12,000
consumed) violates the invariant.

## Setup

Requires Node.js >= 18 (uses the built-in `node:test` runner and ESM).

```bash
npm install   # no-op: no third-party dependencies
npm test      # run the automated assertions
npm run demo  # print the compact comparison
```

> On Node 23+ the `test` script uses an explicit glob
> (`"test/**/*.test.js"`) because newer Node versions no longer treat a
> bare directory argument as "scan this directory". The glob form works
> on Node 18 through 25.

## Files

- `src/unsafe-model.js` — intentionally vulnerable model.
- `src/atomic-model.js` — safe model with an atomic critical section
  (plus an optional async mutex).
- `src/scenario.js` — scenario constants, deterministic scheduler, CLI demo.
- `test/concurrency.test.js` — automated assertions.

## Determinism

The unsafe interleaving is produced by **explicit step ordering**, not by
timers, random delays, or `Promise.all()` scheduling. The scheduler calls
`check` for A, then `check` for B, then `commit` for A, then `commit` for
B. This guarantees the stale-read pattern on every run. This is stronger
than timing-based demonstrations because it removes flakiness: the test
either always reproduces the defect or it doesn't.

## Assumptions

- Single Node.js process, single event-loop thread.
- Amounts are integer cents; no floating-point currency math.
- No real payments, no network calls, no external state.
- The atomic model's critical section is synchronous (no `await` between
  read and write), which makes it atomic **within one event-loop turn**.

## Limitations

- A single-process synchronous critical section does **not** provide
  cross-process, multi-threaded, distributed, or database-level
  atomicity. The "atomic" model in this repository is safe only within
  the stated single-process, single-thread model. Real authorization
  systems require storage-level atomicity (for example, a conditional
  `UPDATE ... WHERE consumed + amount <= limit`, an atomic counter, or a
  serializable transaction) to obtain the same guarantee across
  processes or hosts.
- This experiment does not model transaction isolation levels, write
  skew, or distributed consensus.
- This experiment says nothing about any specific production system.

See `REPORT.md` for a fuller discussion.