/**
 * Deprecated compatibility shim. Install `@argorix/sdk` instead.
 *
 * `@governanceai/sdk` is the pre-rebrand name of the Argorix Node SDK. This package
 * contains no implementation of its own: it depends on `@argorix/sdk` and re-exports it,
 * so existing imports keep working while you migrate.
 */
export * from "@argorix/sdk";

const message =
  "@governanceai/sdk is deprecated after the Argorix rebrand. " +
  "Run 'npm install @argorix/sdk' and import from '@argorix/sdk' instead. " +
  "This shim will stop receiving updates.";

const emitWarning = globalThis.process?.emitWarning;
if (typeof emitWarning === "function") {
  emitWarning(message, "DeprecationWarning");
} else {
  console.warn(message);
}
