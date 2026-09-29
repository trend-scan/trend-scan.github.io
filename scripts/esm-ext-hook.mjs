// Node ESM hooks for running Vite-style (extensionless relative import) source
// files under plain Node — used by `npm test` via `--import`.
//
// Vite resolves './boardEngine' → './boardEngine.js' at build/dev time; Node's
// ESM resolver does not. This hook retries a failed extensionless RELATIVE
// import with '.js' appended. Absolute/bare specifiers (node:*, npm packages,
// '@/' aliases) are passed through untouched — the hook only ever fires when
// default resolution has already failed, so it is a no-op for code that
// already uses explicit extensions.

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !specifier.endsWith('.js')) {
      return next(specifier + '.js', context);
    }
    throw e;
  }
}
