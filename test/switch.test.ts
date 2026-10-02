import { describe, expect, it, vi } from 'vitest'
import { ApiError, NetgearM4250 } from '../src/switch.js'

/** A switch whose raw `request` is scripted, so optional-endpoint reporting can be exercised */
function scriptedSwitch(answers: Array<'ok' | 'reject'>) {
	const log = vi.fn()
	const sw = new NetgearM4250('10.0.0.1', 'admin', 'password', log)
	const queue = [...answers]

	const request = async (path: unknown): Promise<unknown> => {
		const answer = queue.shift()
		if (answer === 'reject') throw new ApiError(`GET ${String(path)} failed: FiberOptics not found`)
		return { fiber_optics: [{ portName: '1/0/20', port: 20, temperature: '40.0' }] }
	}
	const target: any = sw
	target.request = request

	const levels = () => log.mock.calls.map(([level]) => level)
	return { sw, log, levels }
}

describe('optional endpoint reporting', () => {
	it('keeps a short blip of a working endpoint at debug level', async () => {
		const { sw, levels } = scriptedSwitch(['ok', 'reject', 'ok', 'reject', 'reject', 'ok'])

		for (let i = 0; i < 6; i++) await sw.get_fiber_optics()

		expect(levels()).toEqual(['debug', 'debug', 'debug'])
	})

	it('warns once the endpoint has stayed gone, then reports recovery', async () => {
		const { sw, log, levels } = scriptedSwitch(['ok', 'reject', 'reject', 'reject', 'reject', 'ok'])

		for (let i = 0; i < 6; i++) await sw.get_fiber_optics()

		expect(levels()).toEqual(['debug', 'debug', 'warn', 'info'])
		expect(log.mock.calls[2][1]).toMatch(/stopped providing fiber_optics/)
		expect(log.mock.calls[3][1]).toMatch(/answering fiber_optics again/)
	})

	it('reports an endpoint that never answered once, at debug level', async () => {
		const { sw, levels } = scriptedSwitch(['reject', 'reject', 'reject', 'reject'])

		for (let i = 0; i < 4; i++) await sw.get_fiber_optics()

		expect(levels()).toEqual(['debug'])
	})
})
