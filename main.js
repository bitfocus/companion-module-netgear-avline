import { InstanceBase, Regex, runEntrypoint, InstanceStatus } from '@companion-module/base'
import setupActions from './actions.js'
import setupPresets from './presets.js'
import setupVariables from './variables.js'
import setupFeedbacks from './feedbacks.js'
import { upgradeScripts } from './upgrades.js'
import CONSTANTS from './constants.js'

import { NetgearM4250 } from './switch.js'

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.applyConfig(config)
	}

	async destroy() {
		this.stopPolling()
	}

	async configUpdated(config) {
		this.applyConfig(config)
	}

	async applyConfig(config) {
		this.stopPolling()
		this.updateStatus(InstanceStatus.Connecting, 'Opening connection')

		this.switch = new NetgearM4250(config.host, config.user, config.password)

		try {
			this.updateStatus(InstanceStatus.Connecting, 'Logging in')
			const result = await this.switch.login()
			this.updateStatus(InstanceStatus.Connecting, 'Refreshing data')

			if (result === true) {
				// Kick off the main polling loop once we know login was successful
				await this.refreshSwitchData(this)

				// Only mark the connection as `Ok` once we've successfully fetched data the first time
				this.updateStatus(InstanceStatus.Ok, 'Connected')

				// Setup the actions, feedbacks, and variables now that we have data for them
				setupActions(this)
				setupFeedbacks(this)
				setupVariables(this)
				setupPresets(this)
			}
		} catch (error) {
			console.error(error)
			this.log('error', error)
			this.updateStatus(InstanceStatus.UnknownError, 'Unable to log in')
		}
	}

	stopPolling() {
		clearTimeout(this.refreshHandle)
	}

	/*
	 * Runs the main polling loop
	 *
	 * This is where all of the background integration between companion and the switch happens.
	 *
	 * It is called by the startPolling() method and is responsible for:
	 * - Refreshing the login token if it is about to expire
	 * - Refreshing the port poe status
	 * - Refreshing the port stats
	 * - Refreshing the device status
	 *
	 * It uses `setTimeout` in a loop to ensure that the polling continues indefinitely without
	 * any two instances of the method running at the same time – this can overload the switch. It also
	 * ensures ensures that no two HTTP requests are in-flight at the same time. This further reduces load
	 * on the switch.
	 */
	async refreshSwitchData(self) {
		try {
			self.log('debug', 'Refreshing switch data for `' + self.switch.url_or_ip_address + '`')
			self.refreshLoginIfNeeded()
			self.poe_status = await self.switch.get_port_poe_status()
			self.port_stats = await self.switch.get_port_stats()
			self.device_status = await self.switch.get_device_status()
			self.log('debug', 'Switch data refreshed for `' + self.switch.url_or_ip_address + '`')

			// Update the feedbacks and variables at the end of the loop, because otherwise there's tearing
			// in the UI – the PoE status will show as "disabled" but the link status will remain up for a moment
			// even if the device is PoE powered and is already off. Tearing can still happen if the command is issued
			// in the middle of the loop, but it's less likely.
			self.checkFeedbacks()
			self.updateVariables()
		} catch (error) {
			console.error(error)
		} finally {
			self.refreshHandle = setTimeout(self.refreshSwitchData, 1000, self)
		}
	}

	/*
	 * Periodically refreshes the login token as part of the main polling loop
	 */
	async refreshLoginIfNeeded() {
		// Refresh the login token an hour before it expires
		if (this.switch.loginExpiresAt && this.switch.loginExpiresAt < Date.now() - 3600) {
			console.log('Refreshing login token')
			await this.switch.login()
		}

		// Check if the currnet login token is valid – if the switch has rebooted, or someone
		// has used the switch's built-in web interface recently, the token may be invalid.
		try {
			await this.switch.get_device_name()
		} catch (error) {
			this.log('info', 'Login token became invalid, refreshing')
			await this.switch.login()
		}
	}

	/*
	 * Process the new device data and update companion with the new values
	 *
	 * See: https://github.com/bitfocus/companion-module-base/wiki/Variables
	 */
	updateVariables() {
		const changedVars = []

		changedVars['active_ports'] = this.device_status.numOfActivePorts
		changedVars['cpu_usage'] = this.device_status.cpuUsage
		changedVars['memory_usage'] = this.device_status.memoryUsage
		changedVars['uptime'] = this.device_status.upTime

		for (const port of this.poe_status.all()) {
			let poeStatus = CONSTANTS.poeStatusLevels[`${port.status}`]
			let poePower = port.currentPower / 1000

			changedVars[`port_${port.portid}_poe_status`] = poeStatus
			changedVars[`port_${port.portid}_poe_current_power`] = `${poePower} W`
		}

		for (const port of this.port_stats.all()) {
			let portSpeed = CONSTANTS.speedStatusLevels[`${port.speed}`]
			changedVars[`port_${port.portId}_speed`] = portSpeed
			changedVars[`port_${port.portId}_vlans`] = port.vlans
		}

		this.setVariableValues(changedVars)
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'Switch IP',
				width: 4,
				regex: Regex.IP,
			},
			{
				type: 'textinput',
				id: 'user',
				label: 'Username',
				width: 4,
			},
			{
				type: 'textinput',
				id: 'password',
				label: 'Password',
				width: 4,
			},
		]
	}
}

runEntrypoint(ModuleInstance, upgradeScripts)
