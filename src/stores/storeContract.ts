/**
 * Store contract — single source of truth for the store's public shape.
 *
 * Any component that interacts with the store should import `Store` from here
 * to get full type safety against the real API. This makes invented methods
 * impossible: if you write `store.fooBar(...)` and `fooBar` doesn't exist on
 * the real store, TypeScript will reject it at edit time.
 *
 * To see every available method/field, hover `Store` in your editor or read
 * `useAppStore.ts` directly.
 *
 * DO NOT add fields here that don't exist on the real store.
 * DO NOT widen this type to allow arbitrary methods.
 */

import type { useAppStore } from "./useAppStore";

/** The full public shape of the store, derived from the hook's return type. */
export type Store = ReturnType<typeof useAppStore>;

/** Every method name on the store, as a string-literal union. */
export type StoreMethod = {
	[K in keyof Store]: Store[K] extends (...args: never[]) => unknown ? K : never;
}[keyof Store];

/** Every state field name on the store (non-function members). */
export type StoreField = {
	[K in keyof Store]: Store[K] extends (...args: never[]) => unknown ? never : K;
}[keyof Store];

/**
 * Helper: extract the argument types of a store method.
 *
 * @example
 * type AddMessageArgs = StoreMethodArgs<"addMessage">;
 */
export type StoreMethodArgs<K extends StoreMethod> = Store[K] extends (
	...args: infer A
) => unknown
	? A
	: never;

/**
 * Helper: extract the return type of a store method.
 */
export type StoreMethodReturn<K extends StoreMethod> = Store[K] extends (
	...args: never[]
) => infer R
	? R
	: never;