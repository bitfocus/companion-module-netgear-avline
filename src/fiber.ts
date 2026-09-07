import type { FiberOptic, RawFiberOptic } from './types.js'

/** Normalise the model-dependent fields returned by the fibre-optics endpoint. */
export function normaliseFiberOptic(module: RawFiberOptic): FiberOptic | null {
	const port = module.port ?? module.portName?.split('/').at(-1)
	if (port === undefined || port === '') return null

	return {
		...module,
		port: String(port),
		temp: module.temp === undefined ? valueAsString(module.temperature) : valueAsString(module.temp),
	}
}

/** Turn a switch interface name into a Companion-safe variable-id component. */
export function fiberVariableId(port: string): string {
	return String(port).replace(/[^a-zA-Z0-9]+/g, '_')
}

/** Drop entries which cannot produce a useful or valid variable definition. */
export function fibreModules(modules: FiberOptic[]): FiberOptic[] {
	return modules.filter((module) => module.port !== undefined && module.port !== '')
}

function valueAsString(value: string | number | null | undefined): string | undefined {
	return value === undefined || value === null ? undefined : String(value)
}
