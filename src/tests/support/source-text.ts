/**
 * JaliCare HMIS
 * Matching source text without matching its layout
 *
 * WHY THIS EXISTS
 * ---------------
 * The legacy suites in `src/tests/*.test.ts` make structural assertions of
 * the form "this route is registered", "this guard wraps that handler",
 * "this constant is declared". They read the file as text and search it,
 * because the alternative — booting Express and issuing requests — was not
 * available to them when they were written.
 *
 * The problem is that a naive `.includes()` on source text asserts on
 * *formatting* as well as on code. Two examples that actually happened when
 * the tree was run through Prettier:
 *
 *   routes.includes('"/regulators"')
 *     -> broke when the string literal became '/regulators'
 *
 *   service.includes('writeScope: override ? "FACILITY_OVERRIDE" : ...')
 *     -> broke when the literal became 'FACILITY_OVERRIDE'
 *
 *   app.includes("res.status(503).type('text/plain')")
 *     -> broke when the line was wrapped across four lines
 *
 * In each case the assertion stopped testing the thing it was written to
 * test, and started testing the formatter. That is the worst kind of test:
 * it fails for reasons that are not defects, which trains people to ignore
 * it, while still passing if the guarded behaviour is deleted.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * `containsCode` compares whitespace-stripped text and accepts either quote
 * style. It is deliberately narrow:
 *
 *   - Whitespace is ignored, so wrapping and indentation are irrelevant.
 *   - A `'` may stand where the needle has `"` and vice versa.
 *   - Everything else must match exactly, so changing an argument, a
 *     family, a permission code or a route path still fails.
 *
 * That keeps the claim ("the procedure charge asks for family PROCEDURE")
 * while dropping the column numbers and the quote policy. It is not a
 * licence to assert on source text where a behavioural test is practical —
 * `src/tests/vitest/` holds those — it is a way to stop the existing ones
 * from lying.
 */

/** Collapse every run of whitespace, so wrapping and indentation vanish. */
export function squashed(source: string): string {
  return source.replace(/\s+/g, '');
}

/**
 * Does `source` contain `needle`, ignoring layout and quote style?
 *
 * Both sides are whitespace-stripped, and the needle is also tried with its
 * quote characters swapped, which covers Prettier's single-quote policy
 * without demanding that the source use one particular style.
 */
export function containsCode(source: string, needle: string): boolean {
  const flat = squashed(source);

  const variants = new Set([needle, needle.replace(/"/g, "'"), needle.replace(/'/g, '"')]);

  return [...variants].some((variant) => flat.includes(squashed(variant)));
}

/**
 * Count non-overlapping occurrences of `needle`, ignoring layout and quote
 * style.
 *
 * Some assertions are about how many times something appears — "all six
 * routes are gated on this permission", "every handler is wrapped" — and a
 * boolean would lose that. Counting on the raw text would make the expected
 * number depend on whether the formatter kept the call on one line.
 */
export function countCode(source: string, needle: string): number {
  const target = normalised(needle);

  if (target === '') return 0;

  return normalised(source).split(target).length - 1;
}

/** Whitespace-stripped, with quote style flattened so counts are stable. */
export function normalised(source: string): string {
  return squashed(source).replace(/"/g, "'");
}
