/*
 * Ports are entered as text so that an action can cover more than one of them: a single port
 * (`7`), a range (`2-7`), several of either (`12-27, 31-33`), or every port (`all`).
 */

const ALL = /^all$/i

/**
 * Expand a port specification into a sorted list of port numbers.
 *
 * Throws on anything it can't make sense of, so that a typo is reported rather than quietly
 * turning into the wrong set of ports.
 */
export function parsePortSpec(spec: string, allPorts: number[]): number[] {
	const trimmed = spec.trim()
	if (trimmed === '') throw new Error('No ports given')
	if (ALL.test(trimmed)) return [...allPorts].sort((a, b) => a - b)

	const ports = new Set<number>()

	for (const token of trimmed.split(/[,\s]+/)) {
		if (token === '') continue

		const range = /^(\d+)\s*-\s*(\d+)$/.exec(token)
		if (range) {
			const from = Number(range[1])
			const to = Number(range[2])
			if (from > to) throw new Error(`'${token}' is not a valid port range`)

			for (let port = from; port <= to; port++) ports.add(port)
			continue
		}

		if (/^\d+$/.test(token)) {
			ports.add(Number(token))
			continue
		}

		throw new Error(`'${token}' is not a port or port range`)
	}

	if (ports.size === 0) throw new Error('No ports given')

	return [...ports].sort((a, b) => a - b)
}
