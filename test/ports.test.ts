import { describe, expect, it } from 'vitest'
import { parsePortSpec } from '../src/ports.js'

describe('port specifications', () => {
	it('expands ranges, sorts ports, and removes duplicates', () => {
		expect(parsePortSpec('12-14, 3, 13 20-21', [])).toEqual([3, 12, 13, 14, 20, 21])
	})

	it('expands all using the switch port list', () => {
		expect(parsePortSpec('ALL', [4, 1, 2])).toEqual([1, 2, 4])
	})

	it.each(['', '4-', '8-3', '1,wat'])('rejects invalid input %j', (spec) => {
		expect(() => parsePortSpec(spec, [])).toThrow()
	})
})
