
import type { useAppStore } from "./useAppStore";

export type Store = ReturnType<typeof useAppStore>;

export type StoreMethod = {
	[K in keyof Store]: Store[K] extends (...args: never[]) => unknown ? K : never;
}[keyof Store];

export type StoreField = {
	[K in keyof Store]: Store[K] extends (...args: never[]) => unknown ? never : K;
}[keyof Store];

export type StoreMethodArgs<K extends StoreMethod> = Store[K] extends (
	...args: infer A
) => unknown
	? A
	: never;

export type StoreMethodReturn<K extends StoreMethod> = Store[K] extends (
	...args: never[]
) => infer R
	? R
	: never;
