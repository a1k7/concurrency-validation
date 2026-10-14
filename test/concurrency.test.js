import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnsafeBudgetState,
  check as unsafeCheck,
  commit as unsafeCommit,
  remainingBudgetCents as unsafeRemaining,
  invariantHolds as unsafeInvariantHolds,
} from "../src/unsafe-model.js";

import {
  createAtomicBudgetState,
  tryCommit as atomicTryCommit,
  remainingBudgetCents as atomicRemaining,
  invariantHolds as atomicInvariantHolds,
  createMutex,
} from "../src/atomic-model.js";

import {
  SCENARIO,
  runUnsafeScenario,
  runAtomicScenario,
  runAtomicScenarioWithMutex,
} from "../src/scenario.js";

const $ = (dollars) => Math.round(dollars * 100);

/* ------------------------------------------------------------------ */
/* 1. Initial state                                                     */
/* ------------------------------------------------------------------ */

test("initial state: remaining budget is $6,000", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: SCENARIO.authorizationLimitCents,
    consumedCents: SCENARIO.previouslyConsumedCents,
  });
  assert.equal(atomicRemaining(state), $(6_000));
});

/* ------------------------------------------------------------------ */
/* 2–4. Unsafe model                                                    */
/* ------------------------------------------------------------------ */

test("unsafe model: both workers commit under the specified interleaving", () => {
  const { events } = runUnsafeScenario();
  const commits = events.filter((e) => e.phase === "commit");
  assert.equal(commits.length, 2);
  assert.ok(commits.every((c) => c.committed === true));
});

test("unsafe model: final consumed is $12,000", () => {
  const { finalConsumedCents } = runUnsafeScenario();
  assert.equal(finalConsumedCents, $(12_000));
});

test("unsafe model: invariant FAILS", () => {
  const { invariantHolds } = runUnsafeScenario();
  assert.equal(invariantHolds, false);
});

test("unsafe model: worker B used a stale check", () => {
  const { events } = runUnsafeScenario();
  const bCommit = events.find((e) => e.worker === "B" && e.phase === "commit");
  assert.ok(bCommit);
  assert.equal(bCommit.usedStaleCheck, true);
});

/* ------------------------------------------------------------------ */
/* 5–8. Atomic model                                                    */
/* ------------------------------------------------------------------ */

test("atomic model: accepts exactly one request", () => {
  const { events } = runAtomicScenario();
  const accepted = events.filter((e) => e.accepted === true);
  assert.equal(accepted.length, 1);
});

test("atomic model: rejects exactly one request", () => {
  const { events } = runAtomicScenario();
  const rejected = events.filter((e) => e.accepted === false);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /insufficient remaining budget/);
});

test("atomic model: final consumed is $8,000", () => {
  const { finalConsumedCents } = runAtomicScenario();
  assert.equal(finalConsumedCents, $(8_000));
});

test("atomic model: invariant PRESERVED", () => {
  const { invariantHolds } = runAtomicScenario();
  assert.equal(invariantHolds, true);
});

test("atomic model: remaining budget after run is $2,000", () => {
  const { remainingCents } = runAtomicScenario();
  assert.equal(remainingCents, $(2_000));
});

/* ------------------------------------------------------------------ */
/* 9–11. Unit-level behaviour of atomic commit                          */
/* ------------------------------------------------------------------ */

test("atomic: a single request within budget succeeds", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(4_000),
  });
  const r = atomicTryCommit(state, $(6_000));
  assert.equal(r.accepted, true);
  assert.equal(state.consumedCents, $(10_000));
});

test("atomic: a request exceeding remaining budget is rejected", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(4_000),
  });
  const r = atomicTryCommit(state, $(6_001));
  assert.equal(r.accepted, false);
  assert.match(r.reason, /insufficient remaining budget/);
});

test("atomic: rejected transaction does not change consumed amount", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(9_000),
  });
  const before = state.consumedCents;
  const r = atomicTryCommit(state, $(2_000));
  assert.equal(r.accepted, false);
  assert.equal(state.consumedCents, before);
});

/* ------------------------------------------------------------------ */
/* 12. Determinism                                                      */
/* ------------------------------------------------------------------ */

test("determinism: unsafe model is stable across 50 runs", () => {
  for (let i = 0; i < 50; i++) {
    const { finalConsumedCents, invariantHolds } = runUnsafeScenario();
    assert.equal(finalConsumedCents, $(12_000));
    assert.equal(invariantHolds, false);
  }
});

test("determinism: atomic model is stable across 50 runs", () => {
  for (let i = 0; i < 50; i++) {
    const { finalConsumedCents, invariantHolds, events } = runAtomicScenario();
    assert.equal(finalConsumedCents, $(8_000));
    assert.equal(invariantHolds, true);
    assert.equal(events.filter((e) => e.accepted).length, 1);
    assert.equal(events.filter((e) => !e.accepted).length, 1);
  }
});

/* ------------------------------------------------------------------ */
/* Input validation & boundaries                                       */
/* ------------------------------------------------------------------ */

test("validation: negative amount is rejected", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(0),
  });
  assert.throws(() => atomicTryCommit(state, -1), RangeError);
});

test("validation: non-integer amount is rejected", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(0),
  });
  assert.throws(() => atomicTryCommit(state, 1.5), TypeError);
});

test("validation: non-positive authorization limit is rejected", () => {
  assert.throws(
    () => createAtomicBudgetState({ authorizationLimitCents: 0, consumedCents: 0 }),
    RangeError
  );
  assert.throws(
    () => createAtomicBudgetState({ authorizationLimitCents: -100, consumedCents: 0 }),
    RangeError
  );
});

test("validation: consumed greater than limit is rejected", () => {
  assert.throws(
    () => createAtomicBudgetState({ authorizationLimitCents: $(100), consumedCents: $(101) }),
    RangeError
  );
});

test("boundary: request exactly equal to remaining budget is accepted", () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(4_000),
  });
  const r = atomicTryCommit(state, $(6_000));
  assert.equal(r.accepted, true);
  assert.equal(state.consumedCents, $(10_000));
  assert.equal(atomicInvariantHolds(state), true);
});

/* ------------------------------------------------------------------ */
/* Async mutex coverage (releases on accept AND reject)                */
/* ------------------------------------------------------------------ */

test("mutex: releases after a successful transaction", async () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(0),
  });
  const withLock = createMutex();
  const first = await withLock(() => atomicTryCommit(state, $(10_000)));
  assert.equal(first.accepted, true);
  // If the lock did not release, this would hang.
  const second = await withLock(() => atomicTryCommit(state, $(1)));
  assert.equal(second.accepted, false);
});

test("mutex: releases after a rejected transaction", async () => {
  const state = createAtomicBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(9_999),
  });
  const withLock = createMutex();
  const first = await withLock(() => atomicTryCommit(state, $(10)));
  assert.equal(first.accepted, false);
  const second = await withLock(() => atomicTryCommit(state, $(1)));
  assert.equal(second.accepted, true);
});

test("mutex: full scenario preserves invariant", async () => {
  const { invariantHolds, finalConsumedCents, events } = await runAtomicScenarioWithMutex();
  assert.equal(invariantHolds, true);
  assert.equal(finalConsumedCents, $(8_000));
  assert.equal(events.filter((e) => e.accepted).length, 1);
  assert.equal(events.filter((e) => !e.accepted).length, 1);
});

/* ------------------------------------------------------------------ */
/* Direct unsafe-model primitives                                       */
/* ------------------------------------------------------------------ */

test("unsafe primitives: stale decision commits even after budget is gone", () => {
  const state = createUnsafeBudgetState({
    authorizationLimitCents: $(10_000),
    consumedCents: $(4_000),
  });
  const dA = unsafeCheck(state, $(4_000));
  const dB = unsafeCheck(state, $(4_000));
  assert.equal(dA.permitted, true);
  assert.equal(dB.permitted, true);

  unsafeCommit(state, dA);
  unsafeCommit(state, dB);

  assert.equal(state.consumedCents, $(12_000));
  assert.equal(unsafeInvariantHolds(state), false);
  assert.equal(unsafeRemaining(state), -$(2_000));
});