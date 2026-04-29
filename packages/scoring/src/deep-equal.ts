// Audit ref: F-15.
//
// `deepEqual(a, b)` is a stable, key-order-independent structural
// equality check used by the WoW diff (`diffAccount` / `diffOpportunity`)
// to decide whether a canonical field has actually changed between two
// snapshots.
//
// Why this exists:
//   The prior diff used `JSON.stringify(a) !== JSON.stringify(b)` which
//   has three production-relevant failure modes:
//     1. Object-key reordering (e.g. an adapter rewrites { a, b } → { b, a })
//        emits a spurious change event even though the data is identical.
//        That false positive lights up the dashboard's MovementsStrip and
//        wastes manager attention.
//     2. `undefined` and missing keys are not distinguishable as
//        `JSON.stringify` drops `undefined` properties — so { a: 1 } and
//        { a: 1, b: undefined } stringify identically. The diff would
//        miss a real "field cleared" event.
//     3. NaN, Date, and Map values lose information through stringify.
//        We don't currently put any of those on canonical fields, but
//        a robust comparator removes the foot-gun.
//
// Implementation notes:
//   - Plain objects: compare own enumerable string keys, regardless of
//     order. `null` is handled explicitly because `typeof null === 'object'`.
//   - Arrays: deep-compare element-wise; length must match.
//   - Dates: compare `getTime()` so a clone of a Date equals the original.
//   - Primitives: SameValueZero (`Object.is` minus the +0 / -0 quirk we
//     don't care about). NaN === NaN evaluates true.
//   - Functions / Symbols: not expected on canonical data; if encountered
//     fall back to `Object.is`.
//   - No recursion guard — canonical types are flat trees of plain JSON
//     so a cycle would be a bug worth surfacing as a stack overflow.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // SameValueZero: NaN equals NaN.
  if (typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) {
    return true;
  }
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  return false;
}
