import { InstanceBase, InstanceStatus, runEntrypoint, type CompanionVariableValues } from '@companion-module/base'
import { getActionDefinitions } from './actions.js'
import { getPresetDefinitions } from './presets.js'
import { getVariableDefinitions } from './variables.js'
import { getFeedbackDefinitions } from './feedbacks.js'
import { upgradeScripts } from './upgrades.js'
import { getConfigFields, type ModuleConfig, type ModuleSecrets } from './config.js'
import { poeStatusLevels, speedStatusLevels, temperatureSensorStates } from './constants.js'
import { NetgearM4250, type PortPoeConfigurationMap, type PortStatsMap } from './switch.js'
import { temperatureSensors, type DeviceInfo, type PoeConfig } from './types.js'

/*
 * Only the PoE port configuration and the port statistics drive feedbacks, so only they are
 * fetched on every pass. Everything else is either slow-moving (cpu, memory, temperature) or
 * fixed for the lifetime of the switch (model, serial number), and polling it at the same rate
 * would triple the request load for no visible benefit.
 */
const FAST_POLL_INTERVAL_MS = 1000
const DEVICE_INFO_POLL_INTERVAL_MS = 5000
const POE_CONFIG_POLL_INTERVAL_MS = 30000

/** Failed passes back off exponentially from the fast interval up to this, then hold */
const MAX_FAILURE_BACKOFF_MS = 10000

/** Which parts of the switch data changed on the last pass */
interface ChangedData {
	poe: boolean
	stats: boolean
	device: boolean
	poeConfig: boolean
}

const ALL_CHANGED: ChangedData = { poe: true, stats: true, device: true, poeConfig: true }

class ModuleInstance extends InstanceBase<ModuleConfig, ModuleSecrets> {
	switch!: NetgearM4250
	poe_status?: PortPoeConfigurationMap
	port_stats?: PortStatsMap
	device_status?: DeviceInfo
	poe_config?: PoeConfig

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
	private lastSeen: Record<keyof ChangedData, string> = { poe: '', stats: '', device: '', poeConfig: '' }

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
		this.updateStatus(InstanceStatus.Connecting, 'Opening connection')

		// Releasing the previous session talks to the switch, so it must not be awaited either
		const previous = this.switch
		if (previous) void previous.destroy().catch(() => undefined)

		this.switch = new NetgearM4250(config.host, config.user, secrets?.password ?? '', (level, message) =>
			this.log(level, message),
		)

		this.deviceInfoFetchedAt = 0
		this.poeConfigFetchedAt = 0
		this.lastSeen = { poe: '', stats: '', device: '', poeConfig: '' }
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
			this.updateStatus(InstanceStatus.Connecting, 'Logging in')
			await this.switch.login()
			if (generation !== this.generation) return

			this.updateStatus(InstanceStatus.Connecting, 'Refreshing data')
			await this.fetchSwitchData()
			if (generation !== this.generation) return

			// Only mark the connection as `Ok` once we've successfully fetched data the first time
			this.updateStatus(InstanceStatus.Ok, 'Connected')
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
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Unable to log in')
			this.scheduleNextRun(generation, this.failureBackoff(), true)
		}
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

			this.updateStatus(InstanceStatus.Ok, 'Connected')
			this.consecutiveFailures = 0
		} catch (error) {
			if (generation !== this.generation) return

			this.log('error', `Unable to refresh switch data: ${describeError(error)}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Unable to refresh switch data')
			delay = this.failureBackoff()
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

		const changed: ChangedData = {
			poe: this.hasChanged('poe', this.poe_status.all()),
			stats: this.hasChanged('stats', this.port_stats.all()),
			device: false,
			poeConfig: false,
		}

		if (now - this.deviceInfoFetchedAt >= DEVICE_INFO_POLL_INTERVAL_MS) {
			this.device_status = await this.switch.get_device_status()
			this.deviceInfoFetchedAt = now
			changed.device = this.hasChanged('device', this.device_status)
		}

		if (now - this.poeConfigFetchedAt >= POE_CONFIG_POLL_INTERVAL_MS) {
			this.poe_config = await this.switch.get_poe_config()
			this.poeConfigFetchedAt = now
			changed.poeConfig = this.hasChanged('poeConfig', this.poe_config)
		}

		return changed
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
			changedVars['last_reboot'] = device.lastReboot ?? ''
			changedVars['fan_state'] = describeFanState(device.fanState)
			changedVars['poe_budget'] = device.adminPoePower === undefined ? '' : `${device.adminPoePower / 1000} W`

			for (const sensor of temperatureSensors(device)) {
				changedVars[`temperature_${sensor.sensorNum}`] = sensor.sensorTemp
				changedVars[`temperature_${sensor.sensorNum}_state`] =
					sensor.sensorState === undefined ? 'Unknown' : (temperatureSensorStates[sensor.sensorState] ?? 'Unknown')
			}
		}

		if (changed.poeConfig && this.poe_config) {
			changedVars['poe_total_consumption'] = `${this.poe_config.totalPowerConsumedWatts ?? '0'} W`
			changedVars['poe_main_status'] = this.poe_config.pseMainOperationStatus ?? ''
			changedVars['poe_power_management_mode'] = this.poe_config.powerManagmentMode ?? ''
		}

		if (changed.poe) {
			for (const port of this.poe_status?.all() ?? []) {
				changedVars[`port_${port.portid}_poe_status`] = poeStatusLevels[port.status] ?? 'Unknown'
				changedVars[`port_${port.portid}_poe_current_power`] = `${port.currentPower / 1000} W`
			}
		}

		if (changed.stats) {
			for (const port of this.port_stats?.all() ?? []) {
				changedVars[`port_${port.portId}_speed`] = speedStatusLevels[port.speed] ?? 'Unknown'
				changedVars[`port_${port.portId}_vlans`] = port.vlans.join(', ')
			}
		}

		if (Object.keys(changedVars).length > 0) this.setVariableValues(changedVars)
	}
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
