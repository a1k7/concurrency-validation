/**
 * INTENTIONALLY UNSAFE MODEL — FOR SIMULATION ONLY.
 *
 * This module demonstrates a time-of-check-to-time-of-use (TOCTOU) defect
 * in which two workers read the same stale budget observation and both
 * commit, violating a cumulative authorization budget.
 *
 * DO NOT use this pattern in production. It exists only to make the
 * failure mode reproducible and testable.
 *
 * No timers, no randomness. The caller (scenario.js) drives an explicit,
 * deterministic interleaving via check() / commit() calls.
 */

function assertValidAmountCents(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents`);
  }
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
}

export function createUnsafeBudgetState({ authorizationLimitCents, consumedCents = 0 }) {
  if (!Number.isInteger(authorizationLimitCents) || authorizationLimitCents <= 0) {
    throw new RangeError("authorizationLimitCents must be a positive integer");
  }
  assertValidAmountCents(consumedCents, "consumedCents");
  if (consumedCents > authorizationLimitCents) {
    throw new RangeError("consumedCents cannot exceed authorizationLimitCents");
  }

  return {
    authorizationLimitCents,
    consumedCents,
  };
}

/**
 * Step 1–3 of the unsafe model: read the limit and consumed amount,
 * compute remaining, and decide whether the request is permitted.
 * This returns a decision object that the caller may hold indefinitely.
 */
export function check(state, requestAmountCents) {
  assertValidAmountCents(requestAmountCents, "requestAmountCents");

  const limit = state.authorizationLimitCents;
  const consumedAtCheck = state.consumedCents;
  const remainingAtCheck = limit - consumedAtCheck;
  const permitted = requestAmountCents <= remainingAtCheck;

  return {
    requestAmountCents,
    consumedAtCheck,
    remainingAtCheck,
    permitted,
  };
}

/**
 * Step 4 of the unsafe model: commit the request amount without
 * re-reading the current consumed amount. This is the vulnerable step.
 */
export function commit(state, decision) {
  if (!decision.permitted) {
    return { committed: false, reason: "not permitted at check time" };
  }
  // No re-check. Writes based on the stale decision.
  state.consumedCents += decision.requestAmountCents;
  return { committed: true, requestAmountCents: decision.requestAmountCents };
}

export function remainingBudgetCents(state) {
  return state.authorizationLimitCents - state.consumedCents;
}

export function invariantHolds(state) {
  return state.consumedCents <= state.authorizationLimitCents;
}