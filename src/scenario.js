/**
 * Scenario setup and deterministic scheduling for the concurrency experiment.
 *
 * Values are in integer cents.
 *
 * Initial state:
 *   authorizationLimit = 10000_00 = $10,000
 *   previouslyConsumed =  4000_00 = $4,000
 *   remaining          =  6000_00 = $6,000
 * Requests A and B are each $4,000.
 */

import {
  createUnsafeBudgetState,
  check as unsafeCheck,
  commit as unsafeCommit,
  remainingBudgetCents as unsafeRemaining,
  invariantHolds as unsafeInvariantHolds,
} from "./unsafe-model.js";

import {
  createAtomicBudgetState,
  tryCommit as atomicTryCommit,
  remainingBudgetCents as atomicRemaining,
  invariantHolds as atomicInvariantHolds,
  createMutex,
} from "./atomic-model.js";

export const SCENARIO = Object.freeze({
  authorizationLimitCents: 1_000_000, // $10,000
  previouslyConsumedCents:    400_000, // $4,000
  requestACents:              400_000, // $4,000
  requestBCents:              400_000, // $4,000
});

function formatUSD(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

function formatUSDFromDollarsWhole(cents) {
  // Convenience for whole-dollar demo output matching the spec.
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}`;
}

/**
 * Run the UNSAFE model with an explicit, deterministic interleaving:
 *   1. A checks (sees $4,000 consumed, $6,000 remaining, permitted)
 *   2. B checks (sees the same $4,000 consumed, permitted)
 *   3. A commits $4,000 using its decision
 *   4. B commits $4,000 using its stale decision
 */
export function runUnsafeScenario() {
  const state = createUnsafeBudgetState({
    authorizationLimitCents: SCENARIO.authorizationLimitCents,
    consumedCents: SCENARIO.previouslyConsumedCents,
  });

  const events = [];

  const decisionA = unsafeCheck(state, SCENARIO.requestACents);
  events.push({
    worker: "A",
    phase: "check",
    permitted: decisionA.permitted,
    remainingAtCheckCents: decisionA.remainingAtCheck,
  });

  const decisionB = unsafeCheck(state, SCENARIO.requestBCents);
  events.push({
    worker: "B",
    phase: "check",
    permitted: decisionB.permitted,
    remainingAtCheckCents: decisionB.remainingAtCheck,
  });

  const commitA = unsafeCommit(state, decisionA);
  events.push({
    worker: "A",
    phase: "commit",
    committed: commitA.committed,
    requestAmountCents: decisionA.requestAmountCents,
    consumedAfterCents: state.consumedCents,
  });

  const commitB = unsafeCommit(state, decisionB);
  events.push({
    worker: "B",
    phase: "commit",
    committed: commitB.committed,
    requestAmountCents: decisionB.requestAmountCents,
    consumedAfterCents: state.consumedCents,
    usedStaleCheck: true,
  });

  return {
    state,
    events,
    finalConsumedCents: state.consumedCents,
    remainingCents: unsafeRemaining(state),
    invariantHolds: unsafeInvariantHolds(state),
  };
}

/**
 * Run the ATOMIC model with the same two requests.
 * The scheduler is still deterministic; it simply calls tryCommit twice.
 * The first call to arrive wins; the second is rejected on budget.
 */
export function runAtomicScenario() {
  const state = createAtomicBudgetState({
    authorizationLimitCents: SCENARIO.authorizationLimitCents,
    consumedCents: SCENARIO.previouslyConsumedCents,
  });

  const events = [];

  const resultA = atomicTryCommit(state, SCENARIO.requestACents);
  events.push({
    worker: "A",
    accepted: resultA.accepted,
    requestAmountCents: resultA.requestAmountCents,
    consumedAfterCents: resultA.consumedAfter,
    reason: resultA.reason ?? null,
  });

  const resultB = atomicTryCommit(state, SCENARIO.requestBCents);
  events.push({
    worker: "B",
    accepted: resultB.accepted,
    requestAmountCents: resultB.requestAmountCents,
    consumedAfterCents: resultB.consumedAfter,
    reason: resultB.reason ?? null,
  });

  return {
    state,
    events,
    finalConsumedCents: state.consumedCents,
    remainingCents: atomicRemaining(state),
    invariantHolds: atomicInvariantHolds(state),
  };
}

/**
 * Convenience wrapper exposing the async mutex for tests.
 */
export async function runAtomicScenarioWithMutex() {
  const state = createAtomicBudgetState({
    authorizationLimitCents: SCENARIO.authorizationLimitCents,
    consumedCents: SCENARIO.previouslyConsumedCents,
  });
  const withLock = createMutex();
  const events = [];

  const results = await Promise.all([
    withLock(() => {
      const r = atomicTryCommit(state, SCENARIO.requestACents);
      events.push({ worker: "A", ...r });
      return r;
    }),
    withLock(() => {
      const r = atomicTryCommit(state, SCENARIO.requestBCents);
      events.push({ worker: "B", ...r });
      return r;
    }),
  ]);

  // Note: with a single-threaded event loop and a synchronous critical
  // section, serialization is guaranteed by the mutex chain, not by timing.
  return {
    state,
    events,
    results,
    finalConsumedCents: state.consumedCents,
    remainingCents: atomicRemaining(state),
    invariantHolds: atomicInvariantHolds(state),
  };
}

/* ------------------------------------------------------------------ */
/* CLI demo                                                            */
/* ------------------------------------------------------------------ */

function printSeparator(title) {
  console.log("");
  console.log(title);
}

function runDemo() {
  const unsafe = runUnsafeScenario();
  const atomic = runAtomicScenario();

  console.log("SIMULATED CONCURRENCY EXPERIMENT");
  console.log("");
  console.log(`Initial authorization limit: ${formatUSDFromDollarsWhole(SCENARIO.authorizationLimitCents)}`);
  console.log(`Previously consumed:         ${formatUSDFromDollarsWhole(SCENARIO.previouslyConsumedCents)}`);
  console.log(`Remaining budget:            ${formatUSDFromDollarsWhole(SCENARIO.authorizationLimitCents - SCENARIO.previouslyConsumedCents)}`);

  printSeparator("UNSAFE CHECK-THEN-COMMIT");
  for (const e of unsafe.events) {
    if (e.phase === "check") {
      console.log(`Worker ${e.worker}: initial check ${e.permitted ? "passed" : "failed"} (remaining at check ${formatUSDFromDollarsWhole(e.remainingAtCheckCents)})`);
    } else if (e.phase === "commit") {
      if (e.committed) {
        const note = e.usedStaleCheck ? " using stale check" : "";
        console.log(`Worker ${e.worker}: committed ${formatUSDFromDollarsWhole(e.requestAmountCents)}${note}`);
      } else {
        console.log(`Worker ${e.worker}: commit rejected`);
      }
    }
  }
  console.log(`Final consumed: ${formatUSDFromDollarsWhole(unsafe.finalConsumedCents)}`);
  console.log(`Invariant: ${unsafe.invariantHolds ? "PRESERVED" : "FAILED"}`);

  printSeparator("ATOMIC COMMIT");
  for (const e of atomic.events) {
    if (e.accepted) {
      console.log(`Worker ${e.worker}: committed ${formatUSDFromDollarsWhole(e.requestAmountCents)}`);
    } else {
      console.log(`Worker ${e.worker}: rejected — ${e.reason}`);
    }
  }
  console.log(`Final consumed: ${formatUSDFromDollarsWhole(atomic.finalConsumedCents)}`);
  console.log(`Invariant: ${atomic.invariantHolds ? "PRESERVED" : "FAILED"}`);

  console.log("");
  console.log("(Values printed above come from the actual simulated state.)");
}

// Run demo when invoked directly.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  process.argv[1].endsWith("scenario.js");

if (invokedDirectly) {
  runDemo();
}