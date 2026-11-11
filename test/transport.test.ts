import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetch } from 'undici'
import { NetgearM4250, TransportError } from '../src/switch.js'
import { describeConnectFailure } from '../src/errors.js'

vi.mock('undici', () => ({ Agent: class {}, fetch: vi.fn() }))

const fetchMock = vi.mocked(fetch)

function fetchFailure(code: string): TypeError {
	return new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${code}`), { code }) })
}

/** Settles only when the request's own deadline aborts it, as a silent switch would */
async function untilAborted(init: unknown): Promise<never> {
	const signal = (init as { signal: AbortSignal }).signal
	return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason as Error)))
}

function loggedInSwitch(): NetgearM4250 {
	const sw = new NetgearM4250('10.0.0.1', 'buttons', 'password', vi.fn())
	const target: any = sw
	target.token = 'token'
	return sw
}

async function failureOf(promise: Promise<unknown>): Promise<TransportError> {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	)
	expect(error).toBeInstanceOf(TransportError)
	return error as TransportError
}

beforeEach(() => {
	fetchMock.mockReset()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('transport failures', () => {
	it('names the request and the port when the connection cannot be made', async () => {
		fetchMock.mockRejectedValue(fetchFailure('UND_ERR_CONNECT_TIMEOUT'))
		const sw = new NetgearM4250('10.0.0.1', 'buttons', 'password', vi.fn())

		const error = await failureOf(sw.login())

		expect(error.kind).toBe('network')
		expect(error.message).toMatch(
			/^POST login: no connection to 10\.0\.0\.1:8443 after 5s \(port blocked or REST API off\?\)$/,
		)
	})

	it('reports a refused connection', async () => {
		fetchMock.mockRejectedValue(fetchFailure('ECONNREFUSED'))
		const sw = new NetgearM4250('10.0.0.1', 'buttons', 'password', vi.fn())

		const error = await failureOf(sw.login())

		expect(error.message).toBe('POST login: 10.0.0.1:8443 refused connection (REST API off?)')
	})

	it('retries a read that never reached the switch once, then reports it', async () => {
		fetchMock.mockRejectedValue(fetchFailure('EHOSTUNREACH'))

		const error = await failureOf(loggedInSwitch().get_device_status())

		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(error.message).toBe('GET device_info: 10.0.0.1:8443 unreachable (EHOSTUNREACH)')
	})

	it('distinguishes a connected switch that never answers', async () => {
		vi.useFakeTimers()
		fetchMock.mockImplementation(async (_url, init) => untilAborted(init))

		const pending = failureOf(loggedInSwitch().get_port_stats())
		await vi.advanceTimersByTimeAsync(20000)
		const error = await pending

		expect(error.kind).toBe('timeout')
		expect(error.message).toBe('GET sw_portstats?portid=ALL: no reply within 20s')
		// The switch was reached, so a timed-out read is not retried
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	it('distinguishes a response that stalls part way through', async () => {
		vi.useFakeTimers()
		fetchMock.mockImplementation(
			async (_url, init) => ({ status: 200, ok: true, text: async () => untilAborted(init) }) as any,
		)

		const pending = failureOf(loggedInSwitch().get_port_stats())
		await vi.advanceTimersByTimeAsync(20000)
		const error = await pending

		expect(error.kind).toBe('timeout')
		expect(error.message).toBe('GET sw_portstats?portid=ALL: reply stalled, incomplete after 20s')
	})

	it('logs a successful login without the token or the password', async () => {
		const log = vi.fn()
		fetchMock.mockResolvedValue({
			status: 200,
			ok: true,
			text: async () =>
				JSON.stringify({
					resp: { status: 'success', respCode: 0, respMsg: 'Operation success' },
					login: { token: 'secret-token', expires: 300 },
				}),
		} as any)

		await new NetgearM4250('10.0.0.1', 'buttons', 'secret-password', log).login()

		const lines = log.mock.calls.map((call) => String(call[1])).join('\n')
		expect(log).toHaveBeenCalledWith('info', 'Logged in to 10.0.0.1:8443 as buttons, session lasts 300s')
		expect(lines).not.toContain('secret-token')
		expect(lines).not.toContain('secret-password')
	})
})

describe('connect failure reporting', () => {
	it('blames the login only when the login failed', () => {
		const error = new Error('POST login: could not connect')

		expect(describeConnectFailure('login', error)).toEqual({
			log: 'Login failed: POST login: could not connect',
			status: 'Unable to log in',
		})
	})

	it('says the login worked when a later read failed', () => {
		const error = new Error('GET sw_portstats?portid=ALL: the switch did not answer')

		expect(describeConnectFailure('data', error)).toEqual({
			log: 'Data read failed: GET sw_portstats?portid=ALL: the switch did not answer',
			status: 'Unable to read switch data',
		})
	})
})
