# Engineering Findings

## 1. Objective

Determine, under a controlled and deterministic schedule, whether a
non-atomic check-then-commit authorization model can violate a cumulative
budget when two workers act on the same stale observation of consumed
amount, and whether an atomic check-and-commit preserves the invariant in
the same scenario.

This is an independent engineering experiment. It does not use, import,
or claim to have inspected any third-party repository or product, and it
does not establish a vulnerability in German Giraldo's implementation or
in any other real system.

## 2. Scenario and Invariant

Initial state, in integer cents (USD):

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

Both requests are individually valid against the initial remaining budget
of $6,000. Accepting both would produce a total consumed amount of
$12,000, exceeding the $10,000 authorization limit by $2,000. Exactly one
request must therefore succeed.

## 3. Method

Two models over the same initial state, in a single Node.js process, with
all amounts held as integer cents:

- **Unsafe model** (`src/unsafe-model.js`). Exposes `check` and `commit`
  as separate operations. The scheduler in `src/scenario.js` deliberately
  orders the calls so both checks occur before either commit:

  1. Worker A checks — sees $4,000 consumed, $6,000 remaining, permitted.
  2. Worker B checks — sees the same $4,000 consumed, permitted.
  3. Worker A commits $4,000.
  4. Worker B commits $4,000 using its earlier (now stale) decision,
     without rechecking the current total.

  This deterministic interleaving forces the simulated final consumed
  amount to $12,000 and violates the invariant.

- **Atomic model** (`src/atomic-model.js`). Exposes a single `tryCommit`
  that reads the latest consumed amount, checks whether adding the
  request would exceed the limit, and writes only if the check passes —
  with no `await` or yield between the read and the write, making the
  operation indivisible within one event-loop turn. An optional
  dependency-free async mutex is included for illustration and is covered
  by tests.

The interleaving is explicit. No timers, random delays, or reliance on
`Promise.all()` scheduling are used, so the outcome is deterministic
rather than probabilistic.

## 4. Results

| Model | Final consumed | Invariant |
|---|---:|---|
| Unsafe (check-then-commit) | $12,000 | **Violated** |
| Atomic (check-and-commit) | $8,000  | **Preserved** |

Observed simulation outcomes:

- **Unsafe:** both workers commit; consumed becomes $12,000, exceeding
  the $10,000 limit by $2,000. Worker B commits using its stale check.
- **Atomic:** exactly one request is accepted ($4,000) and the other is
  rejected for insufficient remaining budget. Consumed becomes $8,000;
  remaining budget is $2,000.
- Both outcomes are stable across repeated runs (the suite exercises each
  model over 50 iterations).

The 24 automated assertions in `test/concurrency.test.js` cover the
initial state, the unsafe interleaving, the atomic outcome, unit-level
behavior, determinism, input validation, boundary conditions, and mutex
release on both accept and reject paths.

## 5. What the Results Establish

These are observed results of a controlled simulation, not claims about
any external system:

- A model that separates "check remaining budget" from "commit spend" can
  allow two workers to both commit against the same stale observation,
  violating the cumulative budget invariant.
- A model that performs check-and-commit as one indivisible operation
  within a single event-loop turn preserves the invariant in this
  scenario.
- The difference is reproducible deterministically, not
  probabilistically.

## 6. What the Results Do Not Establish

- They do **not** show that any specific product, repository, or demo is
  vulnerable. No third-party repository or source code was accessed; the
  experiment was written independently from a written specification.
- They do **not** show that a single-process synchronous critical section
  is sufficient for multi-process, multi-host, or database-backed
  authorization. It is not.
- They do **not** address real payment execution, revocation, or
  authorization freshness in a production environment.

## 7. Limitations

- The atomic model is safe **only within the stated single-process,
  single-thread model**. A synchronous critical section with no `await`
  between the read and the write is atomic within one event-loop turn; it
  does not provide cross-process, cross-thread, distributed, or
  database-level atomicity.
- The experiment does not model transaction isolation levels, write skew,
  or distributed consensus.
- The experiment says nothing about any specific production system.

## 8. Further Validation Steps

To evaluate whether a specific production implementation has an analogous
defect, the following would be required:

1. The actual transaction boundary — where the check begins and the
   commit ends.
2. The storage and concurrency semantics — optimistic concurrency,
   pessimistic locking, serializable isolation, compare-and-swap, or
   atomic increments.
3. Worker topology — single process, multi-process, or multi-host.
4. Isolation level and any read-your-writes or snapshot guarantees.
5. A reproducible test against that implementation which forces the
   stale-read interleaving without relying on timing.

Only evidence at that level would support a claim about that system.

## 9. Reproduction

```bash
npm install   # no-op, no third-party dependencies
npm test      # 24 assertions; exits non-zero on failure
npm run demo  # prints the compact comparison
```

All assertions are deterministic. The suite exits with a non-zero status
if any assertion fails.