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
	Dot1qPortConfig,
	Dot1qPortConfigResponse,
	FiberOptic,
	FiberOpticsResponse,
	LldpRemoteDevice,
	LldpRemoteDevicesResponse,
	PortConfig,
	PortConfigResponse,
	PortStatsResponse,
	SwitchStatsPort,
	VlanMembership,
	VlanMembershipResponse,
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

export type VlanPortMembership = 'tagged' | 'untagged' | 'excluded'

/** Collapse a list of ports back into ranges for logging: `1-8, 12, 20-21` */
function describePorts(ports: number[]): string {
	const sorted = [...ports].sort((a, b) => a - b)
	const ranges: string[] = []

	for (let i = 0; i < sorted.length;) {
		let end = i
		while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++

		ranges.push(end - i >= 1 ? `${sorted[i]}-${sorted[end]}` : `${sorted[i]}`)
		i = end + 1
	}

	return `${sorted.length === 1 ? 'port' : 'ports'} ${ranges.join(', ')}`
}

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
	/** Set for requests whose failure is expected and shouldn't be read as a rejected token */
	retryOnAuthFailure?: boolean
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

	/** Drop the session so the next request logs in again */
	invalidate_session(): void {
		this.token = null
		this.loginExpiresAt = null
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
		const {
			method = 'GET',
			body,
			authenticated = true,
			retryOnAuthFailure = true,
			timeoutMs = REQUEST_TIMEOUT_MS,
		} = options

		if (authenticated && (this.token === null || this.tokenIsAboutToExpire())) {
			await this.login()
		}

		try {
			return await this.performRequest<T>(path, method, body, authenticated, timeoutMs)
		} catch (error) {
			if (!authenticated || !retryOnAuthFailure || !(error instanceof UnauthorizedError)) throw error

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

		if (response.status === 403) {
			throw new ForbiddenError(`${method} ${path} was refused (403): this account may not be allowed to do that`)
		}

		if (response.status === 401) {
			throw new UnauthorizedError(`${method} ${path} was rejected: ${response.status}`)
		}

		let json: T
		try {
			json = JSON.parse(responseBody) as T
		} catch {
			// An answer arrived, it just wasn't usable – firmware has been seen to return an empty
			// body for endpoints it no longer serves, so this counts as an API failure rather than
			// a transport one, and an optional endpoint can degrade instead of failing the module
			const description = responseBody.trim() === '' ? 'an empty response' : `an unreadable response: ${responseBody}`
			throw new ApiError(`${method} ${path} returned ${description} (${response.status})`)
		}

		if (!response.ok) {
			throw new ApiError(`${method} ${path} failed (${response.status}): ${json.resp?.respMsg ?? responseBody}`)
		}

		// The switch reports command failures – including an unusable token – with a 200 and a
		// failure envelope, so the HTTP status alone isn't enough to know the request worked.
		if (json.resp && json.resp.status !== 'success') {
			const message = json.resp.respMsg ?? 'Unknown error'

			// A refusal on grounds of privilege is checked for first: it reads a lot like an
			// authentication failure, but logging in again would change nothing, so it must not
			// trigger a re-login and a second attempt at the same write.
			if (authenticated && /denied|permission|privilege|not allowed|read.?only|forbidden/i.test(message)) {
				throw new ForbiddenError(`${method} ${path} was refused: ${message}`)
			}

			// Only messages that actually sound like an authentication problem are treated as a dead
			// token. Assuming that of any failed read caused a pointless re-login every time the
			// switch reported an unsupported endpoint. Recovery from an unrecognised rejection is
			// handled by the poll loop instead, which drops the session after repeated failures.
			if (authenticated && /token|authentic|login|session|expire/i.test(message)) {
				throw new UnauthorizedError(`${method} ${path} was rejected: ${message}`)
			}

			throw new ApiError(`${method} ${path} failed: ${message}`)
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
		}

		this.log('debug', `Power cycled POE on ${describePorts(ports)}`)
	}

	/**
	 * The current configuration is fetched once for the whole batch – each write needs the port's
	 * existing configuration, and re-reading it per port would be a request per port.
	 */
	private async setPoePorts(ports: number[], enabled: (config: PoePortConfig) => boolean): Promise<void> {
		const map = await this.get_port_poe_status()

		const changed = { enabled: [] as number[], disabled: [] as number[] }

		for (const port of ports) {
			const config = map.require_port_configuration(port)
			const enable = enabled(config)

			await this.writePoeConfig(port, config, { enable })
			changed[enable ? 'enabled' : 'disabled'].push(port)
		}

		// Logged as one line per outcome – a batch covering every port would otherwise be dozens
		if (changed.enabled.length > 0) this.log('debug', `Enabled POE on ${describePorts(changed.enabled)}`)
		if (changed.disabled.length > 0) this.log('debug', `Disabled POE on ${describePorts(changed.disabled)}`)
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
		const json = await this.optionalRequest<PoeConfigResponse>('swcfg_poe?portid=ALL')
		return new PortPoeConfigurationMap(json?.poePortConfig ?? [])
	}

	async get_port_stats(): Promise<PortStatsMap> {
		const json = await this.request<PortStatsResponse>('sw_portstats?portid=ALL')
		return new PortStatsMap(json.switchStatsPort ?? [])
	}

	/**
	 * Per-port configuration: description, admin mode, and which ports are PoE capable.
	 *
	 * Unlike the port statistics and PoE endpoints, `portid=ALL` is not documented here, so the
	 * bulk form is attempted and the per-port form is used as a fallback. `portCount` bounds that
	 * fallback; without it there is no way to know how far to enumerate.
	 */
	async get_port_configurations(portCount: number): Promise<PortConfigurationMap> {
		if (this.portConfigSupportsAll !== false) {
			try {
				// A switch that doesn't accept `ALL` here answers with a plain failure, which must
				// not be mistaken for a rejected token
				const json = await this.request<PortConfigResponse>('swcfg_port?portid=ALL', {
					retryOnAuthFailure: false,
				})
				const ports = json.switchPortConfig

				if (Array.isArray(ports)) {
					this.portConfigSupportsAll = true
					return new PortConfigurationMap(ports)
				}
			} catch (error) {
				this.log('debug', `Bulk port configuration unavailable: ${error instanceof Error ? error.message : error}`)
			}

			this.portConfigSupportsAll = false
			this.log(
				'info',
				'Switch does not support reading every port configuration at once, falling back to one request per port',
			)
		}

		const ports: PortConfig[] = []
		for (let port = 1; port <= portCount; port++) {
			const json = await this.optionalRequest<PortConfigResponse>(`swcfg_port?portid=${port}`)
			if (json === null) break

			const config = json.switchPortConfig
			if (!Array.isArray(config)) ports.push({ ...config, ID: port })
		}

		return new PortConfigurationMap(ports)
	}

	/**
	 * Issue a request for an endpoint the switch may not support.
	 *
	 * Not every model answers every endpoint – a switch with no transceivers fitted rejects
	 * `fiber_optics` outright, for example – and none of these are worth failing the whole
	 * connection over. An API-level rejection is reported once and treated as "no data";
	 * transport failures and rejected tokens still propagate.
	 */
	private async optionalRequest<T extends ApiResponseEnvelope>(path: string): Promise<T | null> {
		try {
			const json = await this.request<T>(path)
			this.everSucceeded.add(path)
			return json
		} catch (error) {
			if (!(error instanceof ApiError) || error instanceof UnauthorizedError || error instanceof ForbiddenError) {
				throw error
			}

			// An endpoint that has answered before is expected to keep answering, so a failure now
			// is a real problem – not a switch that lacks the feature – and must not be swallowed
			if (this.everSucceeded.has(path)) throw error

			if (!this.unsupported.has(path)) {
				this.unsupported.add(path)
				this.log('info', `Switch does not provide ${path}: ${error.message}`)
			}

			return null
		}
	}

	/** Endpoints that have returned data at least once */
	private readonly everSucceeded = new Set<string>()

	/** Endpoints the switch has rejected, so each is only reported once */
	private readonly unsupported = new Set<string>()

	/** Read one port's configuration, used to refresh a port straight after writing to it */
	async get_port_configuration(port: number): Promise<PortConfig> {
		const json = await this.request<PortConfigResponse>(`swcfg_port?portid=${port}`)
		const config = json.switchPortConfig

		return { ...(Array.isArray(config) ? config[0] : config), ID: port }
	}

	/**
	 * Enable or disable a physical port.
	 *
	 * The API requires the whole port configuration on a write, so the current values are sent
	 * back with only the admin mode changed.
	 */
	async set_port_admin_mode(port: number, adminMode: boolean): Promise<void> {
		const config = await this.get_port_configuration(port)

		await this.request(`swcfg_port?portid=${port}`, {
			method: 'POST',
			body: {
				switchPortConfig: {
					ID: config.ID,
					description: config.description ?? '',
					portType: config.portType ?? 1,
					isPoE: config.isPoE ?? false,
					txRate: config.txRate ?? 0,
					rtlimitUcast: config.rtlimitUcast ?? { status: false, threshold: 5 },
					rtlimitMcast: config.rtlimitMcast ?? { status: false, threshold: 5 },
					rtlimitBcast: config.rtlimitBcast ?? { status: false, threshold: 5 },
					portVlanId: config.portVlanId ?? 1,
					defVlanPrio: config.defVlanPrio ?? 0,
					adminMode,
				},
			},
		})

		this.log('debug', `${adminMode ? 'Enabled' : 'Disabled'} port ${port}`)
	}

	async get_port_vlan_config(port: number): Promise<Dot1qPortConfig> {
		const json = await this.request<Dot1qPortConfigResponse>(`dot1q_sw_port_config?interface=${port}`)
		return json.dot1q_sw_port_config
	}

	/**
	 * Move a port onto a VLAN.
	 *
	 * This sets the port's access VLAN, which is what moving an endpoint between VLANs means for
	 * an access port. The rest of the switchport configuration is read first and sent back
	 * unchanged, because the API requires all of it on a write.
	 */
	async set_port_vlan(port: number, vlan: number): Promise<void> {
		const config = await this.get_port_vlan_config(port)

		await this.request(`dot1q_sw_port_config?interface=${port}`, {
			method: 'POST',
			body: {
				dot1q_sw_port_config: {
					accessVlan: vlan,
					allowedVlanList: config.allowedVlanList ?? ['all'],
					configMode: config.configMode ?? 'access',
					nativeVlan: config.nativeVlan ?? vlan,
				},
			},
		})

		this.log('debug', `Moved port ${port} to VLAN ${vlan}`)
	}

	async get_vlan_membership(vlan: number): Promise<VlanMembership> {
		const json = await this.request<VlanMembershipResponse>(`swcfg_vlan_membership?vlanid=${vlan}`)
		return json.vlanMembership
	}

	/**
	 * Add a port to a VLAN as tagged or untagged, or remove it from the VLAN.
	 *
	 * A write replaces the VLAN's entire membership, so the current membership is read first and
	 * sent back with only this port's entry changed – otherwise every other port would be dropped
	 * out of the VLAN.
	 */
	async set_vlan_membership(port: number, vlan: number, membership: VlanPortMembership): Promise<void> {
		const current = await this.get_vlan_membership(vlan)
		const others = (current.portMembers ?? []).filter((member) => member.port !== port)

		const portMembers = membership === 'excluded' ? others : [...others, { port, tagged: membership === 'tagged' }]

		await this.request('swcfg_vlan_membership', {
			method: 'POST',
			body: { vlanMembership: { ...current, vlanid: vlan, portMembers } },
		})

		this.log(
			'debug',
			membership === 'excluded'
				? `Removed port ${port} from VLAN ${vlan}`
				: `Added port ${port} to VLAN ${vlan} as ${membership}`,
		)
	}

	/** SFP diagnostics for every fibre port */
	async get_fiber_optics(): Promise<FiberOptic[]> {
		const json = await this.optionalRequest<FiberOpticsResponse>('fiber_optics')
		const modules = json?.fiber_optics

		if (!modules) return []
		return Array.isArray(modules) ? modules : [modules]
	}

	/** Devices seen by LLDP, keyed by the interface they were seen on */
	async get_lldp_remote_devices(): Promise<LldpRemoteDevice[]> {
		const json = await this.optionalRequest<LldpRemoteDevicesResponse>('lldp_remote_devices')
		return json?.lldp_remote_devices ?? []
	}

	/** Whether `portid=ALL` works for port configuration; `null` until the first attempt */
	private portConfigSupportsAll: boolean | null = null

	/** Whether refreshing every port's configuration costs a single request */
	get bulk_port_config_supported(): boolean {
		return this.portConfigSupportsAll === true
	}

	/** Switch-wide PoE state – total consumption, power management mode and so on */
	async get_poe_config(): Promise<PoeConfig | null> {
		const json = await this.optionalRequest<PoeConfigGetResponse>('poe_config')
		return json?.poe_config ?? null
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

/**
 * An API-level failure: the switch answered, but reported that it would not or could not do what
 * was asked. Distinct from a transport error, which means we never got an answer at all.
 */
class ApiError extends Error {}

/** Thrown when the switch rejects the session token, so `request` knows to log back in and retry */
class UnauthorizedError extends ApiError {}

/**
 * Thrown when the switch understood who we are and refused anyway.
 *
 * Logging in again cannot help, so this must never be retried – the account simply isn't allowed
 * to make the change. The REST API is documented around the `admin` account, and a lesser account
 * can authenticate but still be unable to write.
 */
class ForbiddenError extends ApiError {}

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

class PortConfigurationMap {
	constructor(private readonly ports: PortConfig[]) {}

	all(): PortConfig[] {
		return this.ports
	}

	get_port_configuration(port_id: number): PortConfig | undefined {
		return this.ports.find((item) => item.ID === port_id)
	}

	/** Replace one port's entry, after that port has been written to */
	replace(config: PortConfig): void {
		const index = this.ports.findIndex((item) => item.ID === config.ID)

		if (index === -1) this.ports.push(config)
		else this.ports[index] = config
	}

	/** Ports the switch reports as PoE capable */
	poe_ports(): PortConfig[] {
		return this.ports.filter((port) => port.isPoE)
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

export { ApiError, ForbiddenError, NetgearM4250, PortConfigurationMap, PortPoeConfigurationMap, PortStatsMap }
