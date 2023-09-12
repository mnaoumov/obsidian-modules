import {
	AbstractFileResolve,
	CompositeResolve,
	ExternalLinkResolve,
	InternalModulesResolve,
	MarkdownLinkResolve,
	RelativePathResolve,
	VaultPathResolve,
	WikilinkResolve,
} from "./resolve.js"
import {
	type AnyObject,
	Functions,
	activeSelf,
	addCommand,
	aroundIdentityFactory,
	attachFunctionSourceMap,
	clearProperties,
	launderUnchecked,
	patchWindows,
	promisePromise,
	sleep2,
} from "@polyipseity/obsidian-plugin-library"
import type {
	Context,
	ImportOptions,
	ModuleCache,
	Require,
	RequireOptions,
	Resolve,
	Resolved,
} from "obsidian-modules"
import { MarkdownTranspile, TypeScriptTranspile } from "./transpile.js"
import { constant, isObject, noop } from "lodash-es"
import {
	patchContextForEditor,
	patchContextForPreview,
	patchContextForTemplater,
} from "./context.js"
import type { ModulesPlugin } from "../main.js"
import { PRECOMPILE_SYNC_PREFIX } from "../magic.js"
import { around } from "monkey-around"
import type { attachSourceMap } from "../worker.js"
import { parse } from "acorn"

export const REQUIRE_TAG = Symbol("require")

export function loadRequire(context: ModulesPlugin): void {
	const
		{
			api: { requires },
			app, app: { workspace },
			language: { value: i18n },
			manifest: { id },
		} = context,
		tsTranspile = new TypeScriptTranspile(context),
		transpiles = [
			new MarkdownTranspile(context, tsTranspile),
			tsTranspile,
		],
		cache = new AbstractFileResolve.Cache(context),
		resolve = new CompositeResolve([
			new InternalModulesResolve(context),
			new RelativePathResolve(context, transpiles, cache),
			new VaultPathResolve(context, transpiles, cache),
			new WikilinkResolve(context, transpiles, cache),
			new MarkdownLinkResolve(context, transpiles, cache),
			new ExternalLinkResolve(context, tsTranspile, `plugin:${id}`),
		])
	context.register(patchWindows(workspace, self0 =>
		patchRequire(context, self0, resolve)))
	patchContextForPreview(context)
	patchContextForEditor(context)
	patchContextForTemplater(context)
	addCommand(context, () => i18n.t("commands.clear-cache"), {
		callback() {
			const { lastEvent } = app;
			(async (): Promise<void> => {
				try {
					await requires.get(activeSelf(lastEvent))?.invalidateAll()
				} catch (error) {
					activeSelf(lastEvent).console.error(error)
				}
			})()
		},
		icon: i18n.t("asset:commands.clear-cache-icon"),
		id: "clear-cache",
	})
}

function createRequire(
	ctx: ModulesPlugin,
	self0: typeof globalThis,
	resolve: Resolve,
	sourceRoot = "",
): Require {
	function invalidate(self2: Require, id: string): void {
		const { aliased, aliases, cache, dependants, dependencies } = self2,
			id2 = aliased[id] ?? id,
			seen = new Set(),
			ing = [...aliases[id2] ?? [id2]]
		for (let cur = ing.shift(); cur !== void 0; cur = ing.shift()) {
			if (seen.has(cur)) { continue }
			seen.add(cur)
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete cache[cur]
			const dependencies2 = dependencies[cur]
			for (const dep of dependencies2 ?? []) {
				dependants[dep]?.delete(cur)
			}
			dependencies2?.clear()
			for (const dep of dependants[cur] ?? []) {
				ing.push(...aliases[dep] ?? [dep])
			}
		}
	}
	function resolve0(
		self2: Require,
		id: string,
		resolved: Resolved | null,
	): readonly [Resolved, ModuleCache] {
		if (!resolved) { throw new Error(id) }
		const { id: id2 } = resolved,
			{ aliased, aliased: { [id]: oldID }, aliases, cache } = self2
		aliased[id] = id2;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		(aliases[id2] ??= new Set([id2])).add(id)
		if (oldID !== void 0 && id2 !== oldID) {
			aliases[oldID]?.delete(id)
			invalidate(self2, id)
		}
		if (resolved.cache === false) {
			// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
			delete cache[id2]
		}
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, no-return-assign
		return [resolved, cache[id2] ??= {}]
	}
	function cache0<T>(
		cache: ModuleCache,
		key: keyof ModuleCache,
		get: () => T,
	): void {
		Object.defineProperty(cache, key, {
			configurable: true,
			enumerable: true,
			get,
		})
	}
	function depends(self1: Require, id: string, context: Context): void {
		const { dependencies, dependants } = self1,
			{ parents } = context,
			parent = parents.at(-1)
		if (parent === void 0) { return }
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		(dependencies[parent] ??= new Set()).add(id);
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		(dependants[id] ??= new Set()).add(parent)
	}
	function preload(
		cleanup: Functions,
		resolved: Resolved,
		context: Context,
	): void {
		const { cwd, id } = resolved,
			{ cwds, parents } = context
		parents.push(id)
		cleanup.push(() => { parents.pop() })
		cwds.push(cwd ?? null)
		cleanup.push(() => { cwds.pop() })
	}
	const ret: Require = Object.assign((id0: string, opts?: RequireOptions) => {
		const cleanup = new Functions({ async: false, settled: true })
		try {
			const { context, context: { cwds }, resolve: resolve1 } = ret,
				cwd = opts?.cwd
			if (cwd !== void 0) {
				cwds.push(cwd)
				cleanup.push(() => { cwds.pop() })
			}
			depends(ret, id0, context)
			const [rd, cache] = resolve0(ret, id0, resolve1.resolve(id0, context)),
				{ code, compiledSyncCode, id, value } = rd
			if ("commonJS" in cache) { return cache.commonJS }
			if ("value" in rd) {
				cache0(cache, "commonJS", constant(value))
				return value
			}
			const module = {
				exports: Object.defineProperty({}, Symbol.toStringTag, {
					configurable: true,
					enumerable: false,
					value: "Module",
					writable: true,
				}),
			}
			cache0(cache, "commonJS", () => module.exports)
			try {
				if (compiledSyncCode === void 0) {
					parse(code, {
						allowAwaitOutsideFunction: false,
						allowHashBang: true,
						allowImportExportEverywhere: false,
						allowReserved: true,
						allowReturnOutsideFunction: false,
						allowSuperOutsideMethod: false,
						ecmaVersion: "latest",
						locations: false,
						preserveParens: false,
						ranges: false,
						sourceType: "script",
					})
				}
				preload(cleanup, rd, context)
				new self0.Function("module", "exports", "process", compiledSyncCode ??
					attachFunctionSourceMap(
						self0.Function,
						`${PRECOMPILE_SYNC_PREFIX}${code}`,
						{
							deletions: [...PRECOMPILE_SYNC_PREFIX].map((_0, idx) => ({
								column: idx,
								line: 1,
							})),
							file: id,
							sourceRoot: `${sourceRoot}${sourceRoot && "/"}${id}`,
						},
						// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
					))(module, module.exports, self0.process ??
						// eslint-disable-next-line @typescript-eslint/naming-convention
						{ env: { NODE_DEV: "production" } })
				const { exports } = module
				if (isObject(exports)) {
					Reflect.defineProperty(exports, Symbol.toStringTag, {
						configurable: false,
						enumerable: false,
						value: "Module",
						writable: false,
					})
				}
				return exports
			} catch (error) {
				cache0(cache, "commonJS", () => { throw error })
				throw error
			}
		} finally {
			cleanup.call()
		}
	}, {
		[REQUIRE_TAG]: true,
		aliased: {},
		aliases: {},
		cache: {},
		context: { cwds: [], parents: [] } satisfies Context,
		dependants: {},
		dependencies: {},
		async import(id0: string, opts?: ImportOptions) {
			const cleanup = new Functions({ async: false, settled: true })
			try {
				const { context, context: { cwds }, resolve: resolve1 } = ret,
					cwd = opts?.cwd
				if (cwd !== void 0) {
					cwds.push(cwd)
					cleanup.push(() => { cwds.pop() })
				}
				depends(ret, id0, context)
				const
					[rd, cache] = resolve0(
						ret,
						id0,
						await resolve1.aresolve(id0, context),
					),
					{ code, id, value } = rd,
					key = opts?.commonJSInterop ?? true
						? "esModuleWithCommonJS"
						: "esModule"
				if (key in cache) { return cache[key] }
				if ("value" in rd) {
					cache0(cache, key, constant(value))
					return value
				}
				const aloader = promisePromise<unknown>()
				cache0(cache, key, async () => (await aloader).promise)
				const loader = await aloader
				loader.resolve((async (): Promise<unknown> => {
					const prefix =
						key === "esModuleWithCommonJS"
							? [
								// eslint-disable-next-line max-len
								"export let module={exports:Object.defineProperty({},Symbol.toStringTag,{configurable:!0,enumerable:!1,value:\"Module\",writable:!0})}",
								"let{exports}=module",
								"let{process}=self;process??={env:{NODE_DEV:\"production\"}}",
								"",
							].join(";")
							: "",
						url = URL.createObjectURL(new Blob(
							[
								await (await ctx.workerPool).exec<typeof attachSourceMap>(
									"attachSourceMap",
									[
										{
											code,
											id,
											prefix,
											sourceRoot,
											type: "module",
										},
									],
								),
							],
							{ type: "text/javascript" },
						))
					cleanup.push(() => { URL.revokeObjectURL(url) })
					const { importTimeout } = ctx.settings.value
					preload(cleanup, rd, context)
					let ret2: unknown = await Promise.race([
						import(url),
						...importTimeout === 0
							? []
							: [
								(async (): Promise<never> => {
									await sleep2(self0, importTimeout)
									throw new Error(id)
								})(),
							],
					])
					if (key === "esModuleWithCommonJS") {
						const mod = isObject(ret2) ? ret2 : { ...ret2 ?? {} },
							{ exports: exports0 } = launderUnchecked<AnyObject>(
								launderUnchecked<AnyObject>(mod)["module"],
							),
							exports = isObject(exports0) ? exports0 : { ...exports0 ?? {} },
							functions = new Map()
						if (isObject(exports)) {
							Reflect.defineProperty(exports, Symbol.toStringTag, {
								configurable: false,
								enumerable: false,
								value: "Module",
								writable: false,
							})
						}
						ret2 = new Proxy(exports, {
							defineProperty(target, property, attributes): boolean {
								if (!(attributes.configurable ?? true) &&
									!Reflect.defineProperty(target, property, attributes)) {
									return false
								}
								return Reflect.defineProperty(mod, property, attributes)
							},
							deleteProperty(target, property): boolean {
								const own = Reflect.getOwnPropertyDescriptor(target, property)
								if (!(own?.configurable ?? true) &&
									!Reflect.deleteProperty(target, property)) {
									return false
								}
								return Reflect.deleteProperty(mod, property)
							},
							get(target, property, receiver): unknown {
								const own = Reflect.getOwnPropertyDescriptor(target, property)
								if (Reflect.has(target, property) ||
									// eslint-disable-next-line @typescript-eslint/no-extra-parens
									(!(own?.configurable ?? true) &&
										// eslint-disable-next-line @typescript-eslint/no-extra-parens
										(!(own?.writable ?? true) || (own?.set && !own.get)))) {
									return Reflect.get(target, property, receiver)
								}
								const ret3: unknown = Reflect.get(
									mod,
									property,
									receiver === target ? mod : receiver,
								)
								if (typeof ret3 === "function") {
									const ret4 = ret3
									// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
									return functions.get(ret3) ?? (() => {
										function fn(
											this: unknown,
											...args: readonly unknown[]
										): unknown {
											// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
											if (new.target) {
												return Reflect.construct(
													ret4,
													args,
													new.target === fn ? ret4 : new.target,
												)
											}
											return Reflect.apply(
												ret4,
												this === ret2 ? mod : this,
												args,
											)
										}
										functions.set(ret3, fn)
										return fn
									})()
								}
								return ret3
							},
							getOwnPropertyDescriptor(
								target,
								property,
							): PropertyDescriptor | undefined {
								let ret3 = Reflect.getOwnPropertyDescriptor(mod, property)
								if (ret3 && !(ret3.configurable ?? true) &&
									!Reflect.defineProperty(target, property, ret3)) {
									ret3 = void 0
								}
								return ret3 ??
									Reflect.getOwnPropertyDescriptor(target, property)
							},
							getPrototypeOf(_0): object | null {
								return Reflect.getPrototypeOf(mod)
							},
							has(target, property): boolean {
								return Reflect.getOwnPropertyDescriptor(target, property)
									?.configurable ?? true
									? Reflect.has(mod, property) || Reflect.has(target, property)
									: Reflect.has(target, property)
							},
							isExtensible(target): boolean {
								return Reflect.isExtensible(target)
							},
							ownKeys(target): ArrayLike<string | symbol> {
								return [
									...new Set([
										Reflect.ownKeys(target),
										Reflect.ownKeys(mod),
										Reflect.ownKeys(target)
											.filter(key2 =>
												!(Reflect.getOwnPropertyDescriptor(target, key2)
													?.configurable ?? true)),
									].flat()),
								]
							},
							preventExtensions(target): boolean {
								return Reflect.preventExtensions(target)
							},
							set(target, property, newValue, receiver): boolean {
								const own = Reflect.getOwnPropertyDescriptor(target, property)
								if (!(own?.configurable ?? true) &&
									// eslint-disable-next-line @typescript-eslint/no-extra-parens
									(!(own?.writable ?? true) || (own?.get && !own.set)) &&
									!Reflect.set(target, property, newValue, receiver)) {
									return false
								} return Reflect.set(
									mod,
									property,
									newValue,
									receiver === target ? mod : receiver,
								)
							},
							setPrototypeOf(_0, proto): boolean {
								return Reflect.setPrototypeOf(mod, proto)
							},
						} satisfies Required<Omit<ProxyHandler<typeof exports
						>, "apply" | "construct">>)
					}
					return ret2
				})())
				return await loader.promise
			} finally {
				cleanup.call()
			}
		},
		async invalidate(id: string) {
			invalidate(ret, id)
			await resolve.invalidate(id)
		},
		async invalidateAll() {
			const { aliased, aliases, cache, dependants, dependencies } = ret
			clearProperties(cache)
			clearProperties(dependants)
			clearProperties(dependencies)
			clearProperties(aliased)
			clearProperties(aliases)
			await resolve.invalidateAll()
		},
		resolve,
	})
	resolve.onInvalidate.listen(id => { invalidate(ret, id) })
	return ret
}

function patchRequire(
	context: ModulesPlugin,
	self0: typeof globalThis,
	resolve: Resolve,
): () => void {
	const { settings } = context
	let destroyer = noop
	const functions = new Functions({ async: false, settled: true })
	try {
		functions.push(() => { destroyer() })
		destroyer =
			createAndSetRequire(context, self0, settings.value.requireName, resolve)
		functions.push(settings.onMutate(
			set => set.requireName,
			cur => {
				destroyer()
				destroyer = createAndSetRequire(context, self0, cur, resolve)
			},
		))
		return () => { functions.call() }
	} catch (error) {
		functions.call()
		throw error
	}
}

function createAndSetRequire(
	context: ModulesPlugin,
	self0: typeof globalThis,
	name: string,
	resolve: Resolve,
): () => void {
	const { api: { requires }, manifest: { id } } = context,
		req = createRequire(context, self0, resolve, `plugin:${id}`)
	requires.set(self0, req)
	if (name in self0 || name === "require") {
		return around(self0, {
			require(proto) {
				return Object.assign(function fn(
					this: typeof self0 | undefined,
					...args: Parameters<typeof proto>
				): ReturnType<typeof proto> {
					try {
						const args2 = [...args]
						// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
						if (args2[1]) { args2[1] = Object.assign(() => { }, args2[1]) }
						return proto.apply(this, args)
					} catch (error) {
						self0.console.debug(error)
						return req(...args)
					}
				}, req) as unknown as NodeRequire
			},
			toString: aroundIdentityFactory(),
		})
	}
	try {
		Object.defineProperty(self0, name, {
			configurable: true,
			enumerable: true,
			value: req,
			writable: false,
		})
		return () => {
			if (Reflect.get(self0, name, self0) === req) {
				Reflect.deleteProperty(self0, name)
			}
		}
	} catch (error) {
		self0.console.error(error)
		return createAndSetRequire(context, self0, "require", resolve)
	}
}
