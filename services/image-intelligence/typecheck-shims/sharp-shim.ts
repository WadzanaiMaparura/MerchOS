// Typecheck-only shim (see tsconfig.typecheck.json). `sharp` is provided by the
// Lambda layer at runtime and is not an npm dependency of this package, so it
// cannot be resolved when type-checking in CI. This is intentionally loose.
declare module 'sharp' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharp: any;
  export default sharp;
}
