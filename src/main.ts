import { InstanceBase, InstanceStatus, runEntrypoint, type CompanionVariableValues } from '@companion-module/base'
import { getActionDefinitions } from './actions.js'
import { getPresetDefinitions } from './presets.js'
import { getVariableDefinitions } from './variables.js'
import { getFeedbackDefinitions } from './feedbacks.js'
import { upgradeScripts } from './upgrades.js'
import { getConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { poeStatusLevels, speedStatusLevels, temperatureSensorStates } from './constants.js'
import {
	ApiError,
	NetgearM4250,
	UnauthorizedError,
	type PortConfigurationMap,
	type PortPoeConfigurationMap,
	type PortStatsMap,
} from './switch.js'
import { temperatureSensors, type DeviceInfo, type FiberOptic, type LldpRemoteDevice, type PoeConfig } from './types.js'

/*
 * Only PoE config and port statistics drive feedbacks, so only they are polled fast; the rest is
 * slow-moving or fixed. The switch's REST agent struggles under a sustained once-a-second poll.
 */
const FAST_POLL_INTERVAL_MS = 2000
const DEVICE_INFO_POLL_INTERVAL_MS = 5000
const POE_CONFIG_POLL_INTERVAL_MS = 30000

/** Failed passes back off exponentially from the fast interval up to this, then hold */
const MAX_FAILURE_BACKOFF_MS = 10000

/** Consecutive failed passes before the session is thrown away and re-established */
const FAILURES_BEFORE_RELOGIN = 3

/*
 * Consecutive failed passes before the connection is reported as down. Switches drop the odd
 * request under load, and reporting a single miss as a disconnect made the connection flap.
 */
const FAILURES_BEFORE_DISCONNECT = 3

/** Which parts of the switch data changed on the last pass */
interface ChangedData {
	poe: boolean
	stats: boolean
	device: boolean
	poeConfig: boolean
	portConfig: boolean
	fiber: boolean
	lldp: boolean
	traffic: boolean
}

const ALL_CHANGED: ChangedData = {
	poe: true,
	stats: true,
	device: true,
	poeConfig: true,
	portConfig: true,
	fiber: true,
	lldp: true,
	traffic: true,
}

class ModuleInstance extends InstanceBase<ModuleConfig, ModuleSecrets> {
	switch!: NetgearM4250
	poe_status?: PortPoeConfigurationMap
	port_stats?: PortStatsMap
	device_status?: DeviceInfo
	poe_config?: PoeConfig
	port_config?: PortConfigurationMap
	fiber_optics: FiberOptic[] = []
	lldp_devices: LldpRemoteDevice[] = []

	/*
	 * Incremented every time the config is applied or the module is destroyed. The polling loop
	 * checks it before rescheduling itself, so a loop belonging to a previous config – which may
	 * have an HTTP request in flight when we tear it down – dies instead of running forever
	 * alongside its replacement.
	 */
	private generation = 0
	private timer: NodeJS.Timeout | undefined

	private deviceInfoFetchedAt = 0
	private poeConfigFetchedAt = 0

	/** Serialized copies of the last response, to avoid republishing data that hasn't changed */
	private lastSeen: Record<keyof ChangedData, string> = {
		poe: '',
		stats: '',
		device: '',
		poeConfig: '',
		portConfig: '',
		fiber: '',
		lldp: '',
		traffic: '',
	}

	/** The system name from the `device_name` endpoint, for switches that omit it from device info */
	private deviceName: string | undefined

	/** The fibre ports the published variable definitions were built for */
	private lastFibrePorts = ''

	/** The last status pushed to Companion, so an unchanged one isn't re-emitted on every poll */
	private lastStatus: string | undefined

	private consecutiveFailures = 0
	private pollInFlight = false
	private refreshQueued = false

	async init(config: ModuleConfig, _isFirstInit: boolean, secrets: ModuleSecrets): Promise<void> {
		this.applyConfig(config, secrets)
	}

	async destroy(): Promise<void> {
		this.stopPolling()
		await this.switch?.destroy()
	}

	async configUpdated(config: ModuleConfig, secrets: ModuleSecrets): Promise<void> {
		this.applyConfig(config, secrets)
	}

	getConfigFields(): ReturnType<typeof getConfigFields> {
		return getConfigFields()
	}

	/*
	 * Companion gives a module a few seconds to initialise, and treats overrunning that as a
	 * failure to load. Logging in and fetching the first set of data can take far longer than
	 * that when the switch is slow or unreachable – several requests, each with its own timeout –
	 * so connecting is started in the background and reported through the connection status
	 * instead of being awaited here.
	 */
	applyConfig(config: ModuleConfig, secrets: ModuleSecrets): void {
		this.stopPolling()

		// A reconfigure should re-announce its progress, even if it lands on the same status
		this.lastStatus = undefined
		this.setStatus(InstanceStatus.Connecting, 'Opening connection')

		// Releasing the previous session talks to the switch, so it must not be awaited either
		const previous = this.switch
		if (previous) void previous.destroy().catch(() => undefined)

		this.switch = new NetgearM4250(config.host, config.user, secrets?.password ?? '', (level, message) =>
			this.log(level, message),
		)

		this.deviceInfoFetchedAt = 0
		this.poeConfigFetchedAt = 0
		this.deviceName = undefined
		this.lastFibrePorts = ''
		this.lastSeen = {
			poe: '',
			stats: '',
			device: '',
			poeConfig: '',
			portConfig: '',
			fiber: '',
			lldp: '',
			traffic: '',
		}
		this.consecutiveFailures = 0

		this.scheduleNextRun(this.generation, 0, true)
	}

	stopPolling(): void {
		this.generation++
		clearTimeout(this.timer)
		this.timer = undefined
		this.refreshQueued = false
	}

	/*
	 * Bring the cached data up to date as soon as possible, rather than waiting for the next
	 * scheduled pass. Actions call this after writing, so a button reflects what it just did
	 * without waiting out the poll interval.
	 */
	refreshNow(): void {
		// The in-flight pass may have read the ports before the write landed, so ask it to run
		// again as soon as it finishes rather than starting a second, overlapping pass
		if (this.pollInFlight) {
			this.refreshQueued = true
			return
		}

		clearTimeout(this.timer)
		this.scheduleNextRun(this.generation, 0)
	}

	/*
	 * Log in and fetch data once, then hand over to the polling loop.
	 *
	 * If the switch is unreachable – rebooting while Companion starts, for example – this retries
	 * on a timer rather than leaving the connection dead until the user edits its config.
	 */
	private async connect(generation: number): Promise<void> {
		try {
			this.setStatus(InstanceStatus.Connecting, 'Logging in')
			await this.switch.login()
			if (generation !== this.generation) return

			this.setStatus(InstanceStatus.Connecting, 'Refreshing data')
			await this.fetchSwitchData()
			if (generation !== this.generation) return

			// Needed before the definitions are built, so that port fields can be bounded to the
			// ports this switch actually has
			this.port_config = await this.switch.get_port_configurations(this.portCount())
			this.fiber_optics = await this.switch.get_fiber_optics()
			this.lldp_devices = await this.switch.get_lldp_remote_devices()
			if (generation !== this.generation) return

			// Only mark the connection as `Ok` once we've successfully fetched data the first time
			this.setStatus(InstanceStatus.Ok, 'Connected')
			this.consecutiveFailures = 0

			// Setup the actions, feedbacks, and variables now that we have data for them
			this.setActionDefinitions(getActionDefinitions(this))
			this.setFeedbackDefinitions(getFeedbackDefinitions(this))
			this.setVariableDefinitions(getVariableDefinitions(this))
			this.setPresetDefinitions(getPresetDefinitions(this))

			this.updateVariables(ALL_CHANGED)
			this.scheduleNextRun(generation, FAST_POLL_INTERVAL_MS)
		} catch (error) {
			if (generation !== this.generation) return

			this.log('error', `Unable to connect: ${describeError(error)}`)
			this.setStatus(InstanceStatus.ConnectionFailure, 'Unable to log in')
			this.scheduleNextRun(generation, this.failureBackoff(), true)
		}
	}

	/*
	 * The poll loop reaches the same status every pass, and re-emitting it fills the connection
	 * log with identical lines. Only transitions are worth reporting.
	 */
	private setStatus(status: InstanceStatus, message: string): void {
		const key = `${status}: ${message}`
		if (key === this.lastStatus) return

		this.lastStatus = key
		this.updateStatus(status, message)
	}

	private scheduleNextRun(generation: number, delay: number, reconnect = false): void {
		this.timer = setTimeout(() => {
			void (reconnect ? this.connect(generation) : this.refreshSwitchData(generation))
		}, delay)
	}

	/*
	 * A switch that is unreachable – or rebooting, which this module can cause itself – shouldn't
	 * be retried at the full polling rate, so failures back off up to a ceiling.
	 */
	private failureBackoff(): number {
		this.consecutiveFailures++

		const delay = FAST_POLL_INTERVAL_MS * 2 ** (this.consecutiveFailures - 1)
		return Math.min(delay, MAX_FAILURE_BACKOFF_MS)
	}

	/*
	 * Runs the main polling loop
	 *
	 * This is where all of the background integration between companion and the switch happens.
	 *
	 * It uses `setTimeout` in a loop to ensure that the polling continues indefinitely without
	 * any two instances of the method running at the same time – this can overload the switch. It also
	 * ensures ensures that no two HTTP requests are in-flight at the same time. This further reduces load
	 * on the switch.
	 */
	private async refreshSwitchData(generation: number): Promise<void> {
		if (generation !== this.generation) return

		let delay = FAST_POLL_INTERVAL_MS
		this.pollInFlight = true

		try {
			const changed = await this.fetchSwitchData()
			if (generation !== this.generation) return

			// Update the feedbacks and variables at the end of the loop, because otherwise there's tearing
			// in the UI – the PoE status will show as "disabled" but the link status will remain up for a moment
			// even if the device is PoE powered and is already off. Tearing can still happen if the command is issued
			// in the middle of the loop, but it's less likely.
			//
			// Feedbacks are checked by id so that a PoE change doesn't also force every link status
			// button to re-render.
			if (changed.poe) this.checkFeedbacks('poeEnabled')
			if (changed.stats) this.checkFeedbacks('linkStatus')
			this.updateVariables(changed)

			this.setStatus(InstanceStatus.Ok, 'Connected')
			this.consecutiveFailures = 0
		} catch (error) {
			if (generation !== this.generation) return

			delay = this.failureBackoff()

			if (this.consecutiveFailures >= FAILURES_BEFORE_DISCONNECT) {
				this.log('error', `Unable to refresh switch data: ${describeError(error)}`)
				this.setStatus(InstanceStatus.ConnectionFailure, 'Unable to refresh switch data')
			} else {
				this.log('debug', `Refresh failed, retrying: ${describeError(error)}`)
			}

			// The switch only names an expired token some of the time, so rather than guessing from
			// the message, a run of failures is taken as reason enough to log in again
			if (this.consecutiveFailures >= FAILURES_BEFORE_RELOGIN) this.switch.invalidate_session()
		} finally {
			this.pollInFlight = false
		}

		if (this.refreshQueued) {
			this.refreshQueued = false
			delay = 0
		}

		if (generation === this.generation) this.scheduleNextRun(generation, delay)
	}

	/*
	 * The requests are deliberately made one after another rather than in parallel, to keep a
	 * single HTTP request in flight against the switch at a time.
	 *
	 * Each response is compared against the previous one so that unchanged data isn't republished
	 * to Companion – on a 40 port switch that would otherwise be a few hundred variable writes a
	 * second, almost all of them identical to the last.
	 */
	private async fetchSwitchData(): Promise<ChangedData> {
		const now = Date.now()

		this.poe_status = await this.switch.get_port_poe_status()
		this.port_stats = await this.switch.get_port_stats()

		const ports = this.port_stats.all()

		/*
		 * Link state and traffic counters arrive in the same response but are compared separately:
		 * the bit rates change almost every second, and lumping them together would mean
		 * re-checking the link feedbacks and republishing every port variable on every pass.
		 */
		const linkState = ports.map((port) => [port.portId, port.speed, port.status, port.vlans])
		const traffic = ports.map((port) => [port.portId, port.rxMbps, port.txMbps, port.trafficRx, port.trafficTx])

		const changed: ChangedData = {
			poe: this.hasChanged('poe', this.poe_status.all()),
			stats: this.hasChanged('stats', linkState),
			traffic: this.hasChanged('traffic', traffic),
			device: false,
			poeConfig: false,
			portConfig: false,
			fiber: false,
			lldp: false,
		}

		if (now - this.deviceInfoFetchedAt >= DEVICE_INFO_POLL_INTERVAL_MS) {
			await this.tolerate('device_info', async () => {
				this.device_status = await this.switch.get_device_status()
				changed.device = this.hasChanged('device', this.device_status)

				await this.fillInDeviceName(this.device_status)
			})

			this.deviceInfoFetchedAt = now
		}

		if (now - this.poeConfigFetchedAt >= POE_CONFIG_POLL_INTERVAL_MS) {
			await this.tolerate('poe_config', async () => {
				this.poe_config = (await this.switch.get_poe_config()) ?? undefined
				changed.poeConfig = this.hasChanged('poeConfig', this.poe_config)
			})

			// Port configuration is refreshed on the same slow tier, but only when the switch can
			// return every port at once – otherwise it would be a request per port
			if (this.switch.bulk_port_config_supported) {
				await this.tolerate('swcfg_port', async () => {
					this.port_config = await this.switch.get_port_configurations(this.portCount())
					changed.portConfig = this.hasChanged('portConfig', this.port_config.all())
				})
			}

			// Transceiver diagnostics and LLDP neighbours move slowly too, and each is one request
			await this.tolerate('fiber_optics', async () => {
				this.fiber_optics = await this.switch.get_fiber_optics()
				changed.fiber = this.hasChanged('fiber', this.fiber_optics)
			})

			await this.tolerate('lldp_remote_devices', async () => {
				this.lldp_devices = await this.switch.get_lldp_remote_devices()
				changed.lldp = this.hasChanged('lldp', this.lldp_devices)
			})

			this.poeConfigFetchedAt = now
		}

		// Transceivers can be fitted and pulled while the module is running, so the SFP variables
		// a switch offers aren't fixed at connect time
		if (changed.fiber) this.republishVariableDefinitions()

		return changed
	}

	/*
	 * Run one step of a polling pass, keeping the last known values if a supplementary endpoint
	 * fails. A rejected token is not absorbed: the poll loop has to see it to log back in.
	 */
	private async tolerate(what: string, step: () => Promise<void>): Promise<void> {
		try {
			await step()
		} catch (error) {
			if (!(error instanceof ApiError) || error instanceof UnauthorizedError) throw error

			this.log('debug', `Keeping the last ${what}: ${describeError(error)}`)
		}
	}

	/*
	 * Some models serve the system name from `device_name` instead of `device_info`. It only
	 * changes on a rename, so it is asked for once and folded into the device info.
	 */
	private async fillInDeviceName(device: DeviceInfo): Promise<void> {
		if (device.name !== undefined && device.name !== '') return

		this.deviceName ??= (await this.switch.get_device_name()) ?? ''
		if (this.deviceName === '') return

		device.name = this.deviceName
	}

	/*
	 * Republish variable definitions so hardware added since connecting gets variables. Companion
	 * treats this as a wholesale replacement, so only do it when the set has really changed.
	 */
	private republishVariableDefinitions(): void {
		const fibrePorts = this.fiber_optics.map((module) => module.port).join(',')
		if (fibrePorts === this.lastFibrePorts) return

		this.lastFibrePorts = fibrePorts
		this.setVariableDefinitions(getVariableDefinitions(this))
	}

	/*
	 * Re-read a single port after writing to it, so its feedbacks and variables update straight
	 * away. Port configuration otherwise only refreshes on the slow tier.
	 */
	async refreshPortConfig(port: number): Promise<void> {
		if (!this.port_config) return

		this.port_config.replace(await this.switch.get_port_configuration(port))
		this.lastSeen.portConfig = JSON.stringify(this.port_config.all())

		this.checkFeedbacks('portEnabled', 'portVlan')
		this.updateVariables({ ...ALL_CHANGED, poe: false, stats: false, device: false, poeConfig: false })
	}

	/*
	 * The number of ports on this switch, used to bound the port fields on actions and feedbacks.
	 * Falls back to the highest port seen in the statistics if the device info didn't report it.
	 */
	portCount(): number {
		const reported = this.device_status?.numOfPorts
		if (reported) return reported

		const ports = this.port_stats?.all() ?? []
		return ports.reduce((highest, port) => Math.max(highest, port.portId), 0)
	}

	/** The ports the switch reports as PoE capable, falling back to whatever the PoE endpoint lists */
	poePortIds(): number[] {
		const capable = this.port_config?.poe_ports() ?? []
		if (capable.length > 0) return capable.map((port) => port.ID)

		return (this.poe_status?.all() ?? []).map((port) => port.portid)
	}

	isPoePort(port: number): boolean {
		const ids = this.poePortIds()
		return ids.length === 0 || ids.includes(port)
	}

	private hasChanged(key: keyof ChangedData, data: unknown): boolean {
		const serialized = JSON.stringify(data)
		if (serialized === this.lastSeen[key]) return false

		this.lastSeen[key] = serialized
		return true
	}

	/*
	 * Process the new device data and update companion with the new values
	 *
	 * See: https://github.com/bitfocus/companion-module-base/wiki/Variables
	 */
	updateVariables(changed: ChangedData): void {
		const changedVars: CompanionVariableValues = {}

		if (changed.device && this.device_status) {
			const device = this.device_status

			changedVars['active_ports'] = device.numOfActivePorts
			changedVars['cpu_usage'] = device.cpuUsage
			changedVars['memory_usage'] = device.memoryUsage
			changedVars['uptime'] = device.upTime
			changedVars['device_name'] = device.name ?? ''
			changedVars['model'] = device.model ?? ''
			changedVars['serial_number'] = device.serialNumber ?? ''
			changedVars['firmware_version'] = device.swVer ?? ''
			changedVars['total_ports'] = device.numOfPorts ?? ''
			changedVars['fan_state'] = describeFanState(device.fanState)

			for (const sensor of temperatureSensors(device)) {
				changedVars[`temperature_${sensor.sensorNum}`] = sensor.sensorTemp
				changedVars[`temperature_${sensor.sensorNum}_state`] =
					sensor.sensorState === undefined ? 'Unknown' : (temperatureSensorStates[sensor.sensorState] ?? 'Unknown')
			}
		}

		if (changed.poeConfig && this.poe_config) {
			const consumedWatts = asNumber(this.poe_config.totalPowerConsumedWatts) ?? 0

			changedVars['poe_total_consumption'] = `${consumedWatts} W`
			changedVars['poe_total_consumption_watts'] = consumedWatts
			changedVars['poe_usage_threshold'] = asNumber(this.poe_config.usageThreshold) ?? ''
			changedVars['poe_main_status'] = this.poe_config.pseMainOperationStatus ?? ''
			changedVars['poe_power_management_mode'] = this.poe_config.powerManagmentMode ?? ''
		}

		if (changed.poe) {
			for (const port of this.poe_status?.all() ?? []) {
				changedVars[`port_${port.portid}_poe_status`] = poeStatusLevels[port.status] ?? 'Unknown'
				changedVars[`port_${port.portid}_poe_current_power`] = `${port.currentPower / 1000} W`
			}
		}

		if (changed.portConfig) {
			for (const port of this.port_config?.all() ?? []) {
				changedVars[`port_${port.ID}_description`] = port.description ?? ''
				changedVars[`port_${port.ID}_poe_capable`] = port.isPoE ?? false
				changedVars[`port_${port.ID}_admin_mode`] =
					port.adminMode === undefined ? '' : port.adminMode ? 'Enabled' : 'Disabled'
				changedVars[`port_${port.ID}_access_vlan`] = port.portVlanId ?? ''
			}

			changedVars['poe_ports'] = this.poePortIds().length
		}

		if (changed.fiber) {
			for (const module of fibreModules(this.fiber_optics)) {
				const id = fiberVariableId(module.port)

				changedVars[`sfp_${id}_temperature`] = module.temp ?? ''
				changedVars[`sfp_${id}_voltage`] = module.voltage ?? ''
				changedVars[`sfp_${id}_current`] = module.current ?? ''
				changedVars[`sfp_${id}_input_power`] = module.inputPower ?? ''
				changedVars[`sfp_${id}_output_power`] = module.outputPower ?? ''
				changedVars[`sfp_${id}_loss_of_signal`] = module.los ?? ''
				changedVars[`sfp_${id}_tx_fault`] = module.txFault ?? ''
				changedVars[`sfp_${id}_fault_status`] = module.faultStatus ?? ''
				changedVars[`sfp_${id}_vendor`] = module.vendorName ?? ''
				changedVars[`sfp_${id}_part_number`] = module.partNumber ?? ''
				changedVars[`sfp_${id}_serial_number`] = module.serialNumber ?? ''
			}
		}

		if (changed.lldp) {
			for (let port = 1; port <= this.portCount(); port++) {
				changedVars[`port_${port}_lldp_system_name`] = ''
				changedVars[`port_${port}_lldp_port_id`] = ''
				changedVars[`port_${port}_lldp_port_description`] = ''
				changedVars[`port_${port}_lldp_chassis_id`] = ''
			}

			for (const device of this.lldp_devices) {
				changedVars[`port_${device.ifIndex}_lldp_system_name`] = device.remoteSysName ?? ''
				changedVars[`port_${device.ifIndex}_lldp_port_id`] = device.remotePortId ?? ''
				changedVars[`port_${device.ifIndex}_lldp_port_description`] = device.remotePortDesc ?? ''
				changedVars[`port_${device.ifIndex}_lldp_chassis_id`] = device.chassisId ?? ''
			}
		}

		if (changed.stats) {
			for (const port of this.port_stats?.all() ?? []) {
				changedVars[`port_${port.portId}_speed`] = speedStatusLevels[port.speed] ?? 'Unknown'
				changedVars[`port_${port.portId}_vlans`] = port.vlans.join(', ')
			}
		}

		if (changed.traffic) {
			for (const port of this.port_stats?.all() ?? []) {
				// Rates are published unitless so they can be compared and formatted in expressions
				changedVars[`port_${port.portId}_rx_mbps`] = port.rxMbps ?? ''
				changedVars[`port_${port.portId}_tx_mbps`] = port.txMbps ?? ''
				changedVars[`port_${port.portId}_rx_bytes`] = port.trafficRx ?? ''
				changedVars[`port_${port.portId}_tx_bytes`] = port.trafficTx ?? ''
			}
		}

		if (Object.keys(changedVars).length > 0) this.setVariableValues(changedVars)
	}
}

/* The switch reports fibre ports as free-form strings such as `1/0/49`, which can't be used as-is */
export function fiberVariableId(port: string): string {
	return String(port).replace(/[^a-zA-Z0-9]+/g, '_')
}

/*
 * Transceivers the module can name. An entry without a port can't be turned into a variable id –
 * it would produce `sfp_undefined_temperature` – and has nothing useful to show either.
 */
export function fibreModules(modules: FiberOptic[]): FiberOptic[] {
	return modules.filter((module) => module.port !== undefined && module.port !== '')
}

/* Firmware is inconsistent about whether a figure arrives as a number or as a string */
function asNumber(value: unknown): number | null {
	if (value === undefined || value === null || value === '') return null

	const number = Number(value)
	return Number.isFinite(number) ? number : null
}

/* Documented as an array of objects, but firmware has been seen to send a bare string */
function describeFanState(fanState: unknown): string {
	if (typeof fanState === 'string') return fanState
	if (!Array.isArray(fanState)) return ''

	return fanState
		.map((fan) => (typeof fan === 'string' ? fan : Object.values(fan as Record<string, string>).join(' ')))
		.join(', ')
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export { ModuleInstance }

runEntrypoint(ModuleInstance, upgradeScripts)
