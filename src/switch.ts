import { Agent, fetch } from 'undici'
import type { LogLevel } from '@companion-module/base'
import type {
	ApiResponseEnvelope,
	DeviceInfo,
	DeviceInfoResponse,
	DeviceNameResponse,
	LoginResponse,
	PoeConfig,
	PoeConfigGetResponse,
	PoeConfigResponse,
	PoePortConfig,
	PortStatsResponse,
	SwitchStatsPort,
} from './types.js'

export type SwitchLogger = (level: LogLevel, message: string) => void

const API_PORT = 8443
const REQUEST_TIMEOUT_MS = 5000

// Log back in this long before the token is due to expire
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000

/*
 * Logging out happens while the module is being torn down, and Companion is waiting on that, so
 * it gets a much shorter deadline than a normal request – an unreachable switch must not stall
 * the shutdown for the full request timeout.
 */
const LOGOUT_TIMEOUT_MS = 1500

// How long an idle connection is held open for reuse between polls
const KEEP_ALIVE_TIMEOUT_MS = 60 * 1000

/** The mutable part of a PoE port write */
interface PoePortConfigWrite {
	enable?: boolean
	reset?: boolean
}

interface RequestOptions {
	method?: 'GET' | 'POST'
	body?: unknown
	/** Login requests must not try to re-authenticate on failure, or they would recurse */
	authenticated?: boolean
	timeoutMs?: number
}

class NetgearM4250 {
	readonly url_or_ip_address: string

	private readonly username: string
	private readonly password: string
	private readonly log: SwitchLogger
	private readonly agent: Agent

	private token: string | null = null
	private loginExpiresAt: number | null = null
	private tokenLifetimeMs = 0
	private loginInFlight: Promise<void> | null = null

	constructor(url_or_ip_address: string, username: string, password: string, log: SwitchLogger) {
		this.url_or_ip_address = url_or_ip_address
		this.username = username
		this.password = password
		this.log = log

		// The switch serves its API over a self-signed certificate.
		//
		// The keep-alive window is stretched well past undici's 4s default so that the slower
		// polls – device info every few seconds, switch PoE state every thirty – reuse the
		// connection instead of paying for a TLS handshake each time.
		this.agent = new Agent({
			connect: { rejectUnauthorized: false },
			keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
			keepAliveMaxTimeout: KEEP_ALIVE_TIMEOUT_MS,
		})
	}

	/**
	 * Log in and store the session token.
	 *
	 * Concurrent calls share a single in-flight request so that a re-login triggered by an expired
	 * token can't race a scheduled refresh and leave the two overwriting each other's tokens.
	 */
	async login(): Promise<void> {
		this.loginInFlight ??= this.performLogin().finally(() => {
			this.loginInFlight = null
		})

		return this.loginInFlight
	}

	async destroy(): Promise<void> {
		await this.logout()
		await this.agent.close()
	}

	private async performLogin(): Promise<void> {
		const data = await this.request<LoginResponse>('login', {
			method: 'POST',
			body: { login: { username: this.username, password: this.password } },
			authenticated: false,
		})

		this.token = data.login.token

		const lifetime = Number(data.login.expires)
		this.tokenLifetimeMs = Number.isFinite(lifetime) && lifetime > 0 ? lifetime * 1000 : 0
		this.loginExpiresAt = this.tokenLifetimeMs > 0 ? Date.now() + this.tokenLifetimeMs : null
	}

	/**
	 * Release the session token.
	 *
	 * Best-effort: the module is being torn down either way, and there is nothing useful to do
	 * with a failure. Without this, every reconnect would abandon a live session on the switch.
	 */
	private async logout(): Promise<void> {
		if (this.token === null) return

		try {
			await this.performRequest('logout', 'POST', undefined, true, LOGOUT_TIMEOUT_MS)
		} catch (error) {
			this.log('debug', `Failed to log out: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			this.token = null
			this.loginExpiresAt = null
		}
	}

	/**
	 * Issue a single API request, returning the parsed body.
	 *
	 * Throws on transport errors, non-2xx responses and on API-level failures reported in the
	 * response envelope, so that callers never mistake a rejected command for a successful one.
	 * If the token has expired – or the switch rejects it because it rebooted or someone else
	 * logged into the web UI – this logs back in and retries the request once.
	 */
	private async request<T extends ApiResponseEnvelope>(path: string, options: RequestOptions = {}): Promise<T> {
		const { method = 'GET', body, authenticated = true, timeoutMs = REQUEST_TIMEOUT_MS } = options

		if (authenticated && (this.token === null || this.tokenIsAboutToExpire())) {
			await this.login()
		}

		try {
			return await this.performRequest<T>(path, method, body, authenticated, timeoutMs)
		} catch (error) {
			if (!authenticated || !(error instanceof UnauthorizedError)) throw error

			this.log('info', 'Login token became invalid, refreshing')
			this.token = null
			await this.login()

			return this.performRequest<T>(path, method, body, authenticated, timeoutMs)
		}
	}

	/**
	 * The margin is clamped to half the token's lifetime, so that a switch reporting a very short
	 * lifetime doesn't make us log in ahead of every single request.
	 */
	private tokenIsAboutToExpire(): boolean {
		if (this.loginExpiresAt === null) return false

		const remaining = this.loginExpiresAt - Date.now()
		return remaining < Math.min(TOKEN_REFRESH_MARGIN_MS, this.tokenLifetimeMs / 2)
	}

	private async performRequest<T extends ApiResponseEnvelope>(
		path: string,
		method: 'GET' | 'POST',
		body: unknown,
		authenticated: boolean,
		timeoutMs: number = REQUEST_TIMEOUT_MS,
	): Promise<T> {
		const response = await fetch(`https://${this.url_or_ip_address}:${API_PORT}/api/v1/${path}`, {
			method,
			dispatcher: this.agent,
			signal: AbortSignal.timeout(timeoutMs),
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(authenticated ? { Authorization: `Bearer ${this.token}` } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		})

		const responseBody = await response.text()

		if (response.status === 401 || response.status === 403) {
			throw new UnauthorizedError(`${method} ${path} was rejected: ${response.status}`)
		}

		let json: T
		try {
			json = JSON.parse(responseBody) as T
		} catch {
			throw new Error(`${method} ${path} returned an unreadable response (${response.status}): ${responseBody}`)
		}

		if (!response.ok) {
			throw new Error(`${method} ${path} failed (${response.status}): ${json.resp?.respMsg ?? responseBody}`)
		}

		// The switch reports command failures – including an unusable token – with a 200 and a
		// failure envelope, so the HTTP status alone isn't enough to know the request worked.
		if (json.resp && json.resp.status !== 'success') {
			const message = json.resp.respMsg ?? 'Unknown error'

			if (authenticated && (method === 'GET' || /token|auth|login|session|denied|permission/i.test(message))) {
				throw new UnauthorizedError(`${method} ${path} was rejected: ${message}`)
			}

			throw new Error(`${method} ${path} failed: ${message}`)
		}

		return json
	}

	/**
	 * Enable POE on a list of ports
	 */
	async enable_poe_ports(ports: number[]): Promise<void> {
		await this.setPoePorts(ports, () => true)
	}

	/**
	 * Disable POE on a list of ports
	 */
	async disable_poe_ports(ports: number[]): Promise<void> {
		await this.setPoePorts(ports, () => false)
	}

	/**
	 * Toggle POE on a list of ports
	 */
	async toggle_poe_ports(ports: number[]): Promise<void> {
		await this.setPoePorts(ports, (config) => !config.enable)
	}

	/**
	 * Power cycle POE on a list of ports
	 */
	async power_cycle_poe_ports(ports: number[]): Promise<void> {
		const map = await this.get_port_poe_status()

		for (const port of ports) {
			await this.writePoeConfig(port, map.require_port_configuration(port), { reset: true })
			this.log('debug', `Power cycled POE on port ${port}`)
		}
	}

	/**
	 * The current configuration is fetched once for the whole batch – each write needs the port's
	 * existing configuration, and re-reading it per port would be a request per port.
	 */
	private async setPoePorts(ports: number[], enabled: (config: PoePortConfig) => boolean): Promise<void> {
		const map = await this.get_port_poe_status()

		for (const port of ports) {
			const config = map.require_port_configuration(port)
			const enable = enabled(config)

			await this.writePoeConfig(port, config, { enable })
			this.log('debug', `${enable ? 'Enabled' : 'Disabled'} POE on port ${port}`)
		}
	}

	/*
	 * Only the fields the API documents as required are sent, plus `reset` when power cycling.
	 * Echoing the whole configuration back would include read-only fields like `status` and
	 * `currentPower`, and the port id must not be repeated in the body.
	 */
	private async writePoeConfig(port: number, config: PoePortConfig, changes: PoePortConfigWrite): Promise<void> {
		await this.request(`swcfg_poe?portid=${port}`, {
			method: 'POST',
			body: {
				poePortConfig: {
					enable: config.enable,
					powerLimitMode: config.powerLimitMode,
					classification: config.classification,
					powerLimit: config.powerLimit,
					...changes,
				},
			},
		})
	}

	async power_cycle_switch(): Promise<void> {
		this.log('info', 'Power cycling switch')

		await this.request('device_reboot', {
			method: 'POST',
			body: { deviceReboot: { afterSecs: 2 } },
		})
	}

	async get_port_poe_status(): Promise<PortPoeConfigurationMap> {
		const json = await this.request<PoeConfigResponse>('swcfg_poe?portid=ALL')
		return new PortPoeConfigurationMap(json.poePortConfig ?? [])
	}

	async get_port_stats(): Promise<PortStatsMap> {
		const json = await this.request<PortStatsResponse>('sw_portstats?portid=ALL')
		return new PortStatsMap(json.switchStatsPort ?? [])
	}

	/** Switch-wide PoE state – total consumption, power management mode and so on */
	async get_poe_config(): Promise<PoeConfig> {
		const json = await this.request<PoeConfigGetResponse>('poe_config')
		return json.poe_config
	}

	/*
	 * Copy the running configuration to the startup configuration.
	 *
	 * Everything this module changes – PoE port state in particular – is applied to the running
	 * configuration only, and is lost when the switch restarts unless it is saved.
	 */
	async save_configuration(): Promise<void> {
		this.log('info', 'Saving running configuration to startup configuration')
		await this.request('config_copy?directive=rtos', { method: 'POST' })
	}

	async get_device_name(): Promise<string> {
		const json = await this.request<DeviceNameResponse>('device_name')
		return json.deviceName.name
	}

	async get_device_status(): Promise<DeviceInfo> {
		const json = await this.request<DeviceInfoResponse>('device_info')
		return json.deviceInfo
	}
}

/** Thrown when the switch rejects the session token, so `request` knows to log back in and retry */
class UnauthorizedError extends Error {}

class PortPoeConfigurationMap {
	constructor(private readonly ports: PoePortConfig[]) {}

	all(): PoePortConfig[] {
		return this.ports
	}

	has(port_id: number): boolean {
		return this.ports.some((item) => item.portid === port_id)
	}

	get_port_configuration(port_id: number): PoePortConfig | undefined {
		return this.ports.find((item) => item.portid === port_id)
	}

	require_port_configuration(port_id: number): PoePortConfig {
		const config = this.get_port_configuration(port_id)
		if (!config) throw new Error(`Port ${port_id} does not support POE, or does not exist on this switch`)
		return config
	}
}

class PortStatsMap {
	constructor(private readonly ports: SwitchStatsPort[]) {}

	all(): SwitchStatsPort[] {
		return this.ports
	}

	has(port_id: number): boolean {
		return this.ports.some((item) => item.portId === port_id)
	}

	get_port_stats(port_id: number): SwitchStatsPort | undefined {
		return this.ports.find((item) => item.portId === port_id)
	}
}

export { NetgearM4250, PortPoeConfigurationMap, PortStatsMap }
