/**
 * SAFE MODEL — atomic check-and-commit within a single-process critical section.
 *
 * IMPORTANT: A synchronous critical section with no `await` between the
 * check and the write is atomic *within a single JS event-loop turn*.
 * It does NOT provide cross-process, cross-thread, or database-level
 * atomicity. See REPORT.md for limitations.
 *
 * An optional async mutex variant is provided for illustration; it is
 * exercised by tests to confirm it releases on both accept and reject.
 */

function assertValidAmountCents(value, label) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${label} must be an integer number of cents`);
  }
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative`);
  }
}

export function createAtomicBudgetState({ authorizationLimitCents, consumedCents = 0 }) {
  if (!Number.isInteger(authorizationLimitCents) || authorizationLimitCents <= 0) {
    throw new RangeError("authorizationLimitCents must be a positive integer");
  }
  assertValidAmountCents(consumedCents, "consumedCents");
  if (consumedCents > authorizationLimitCents) {
    throw new RangeError("consumedCents cannot exceed authorizationLimitCents");
  }
  return { authorizationLimitCents, consumedCents };
}

/**
 * Atomic synchronous check-and-commit.
 * Read → check → write happen with no yield in between.
 * Returns a structured result; never partially commits.
 */
export function tryCommit(state, requestAmountCents) {
  assertValidAmountCents(requestAmountCents, "requestAmountCents");

  const limit = state.authorizationLimitCents;
  const currentConsumed = state.consumedCents;          // read
  const remaining = limit - currentConsumed;
  if (requestAmountCents > remaining) {                  // check
    return {
      accepted: false,
      reason: "insufficient remaining budget",
      requestAmountCents,
      remainingBeforeCommit: remaining,
      consumedAfter: state.consumedCents,
    };
  }
  state.consumedCents = currentConsumed + requestAmountCents; // write
  return {
    accepted: true,
    requestAmountCents,
    remainingBeforeCommit: remaining,
    consumedAfter: state.consumedCents,
  };
}

export function remainingBudgetCents(state) {
  return state.authorizationLimitCents - state.consumedCents;
}

export function invariantHolds(state) {
  return state.consumedCents <= state.authorizationLimitCents;
}

/**
 * Dependency-free async mutex, provided for illustration and test coverage.
 * Ensures serialized access; releases on both accept and reject paths
 * via try/finally.
 */
export function createMutex() {
  let tail = Promise.resolve();
  return function withLock(fn) {
    const run = tail.then(() => fn());
    // Keep the chain alive regardless of fn() outcome.
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}