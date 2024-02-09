import { InstanceBase, Regex, runEntrypoint, InstanceStatus } from '@companion-module/base'
import { getActions } from './actions.js'
import { getPresets } from './presets.js'
import { getVariables } from './variables.js'
import { getFeedbacks } from './feedbacks.js'
import { upgradeScripts } from './upgrades.js'
import CONSTANTS from './constants.js'

import fetch from 'node-fetch'
import https from 'https'

class ModuleInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
	}

	async init(config) {
		this.config = config
		this.switch = {}
		this.updateStatus(InstanceStatus.Connecting)

		this.initConnection()
		this.initVariables()
		this.initFeedbacks()
		this.initActions()
	}

	async destroy() {
		this.log('debug', 'destroy')
		this.stopSwitchPoll()
	}

	async configUpdated(config) {
		this.config = config
		this.init(config)
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

	initVariables() {
		const variables = getVariables.bind(this)()
		this.setVariableDefinitions(variables)
	}

	initFeedbacks() {
		const feedbacks = getFeedbacks.bind(this)()
		this.setFeedbackDefinitions(feedbacks)
	}

	initPresets() {
		const presets = getPresets.bind(this)()
		this.setPresetDefinitions(presets)
	}

	initActions() {
		const actions = getActions.bind(this)()
		this.setActionDefinitions(actions)
	}

	initConnection() {
		this.stopSwitchPoll()
		this.httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		})

		let params = {
			login: {
				username: this.config.user,
				password: this.config.password,
			},
		}
		params = JSON.stringify(params)

		fetch(`https://${this.config.host}:8443/api/v1/login`, {
			method: 'post',
			body: params,
			headers: { 'Content-Type': 'application/json' },
			agent: this.httpsAgent,
		})
			.then((res) => {
				if (res.status == 200) {
					return res.json()
				}
			})
			.then((json) => {
				let data = json
				if (data) {
					if (data.resp?.status == 'success') {
						this.updateStatus(InstanceStatus.Ok)
						this.switch.token = data.login.token
						this.switch.tokenExpire = data.login.expire

						this.getSwitchInfo()
						this.sendCommand('sw_portstats?portid=ALL', 'get')
						this.startSwitchPoll()
					} else {
						this.updateStatus(InstanceStatus.BadConfig)
						this.log('error', `Unable to login to Netgear switch, please verify your username and password`)
						this.log('debug', String(data.resp))
					}
				}
			})
			.catch((error) => {
				if (error.code) {
					let code = error.code
					this.log('error', `Unable to connect to Netgear switch (${code})`)
				} else {
					this.log('error', `Unable to connect to Netgear switch`)
					this.log('debug', String(error))
				}
				this.updateStatus(InstanceStatus.ConnectionFailure)
			})
	}

	getSwitchInfo() {
		this.sendCommand('device_info', 'get')
		this.sendCommand('swcfg_poe?portid=ALL', 'get')
		this.sendCommand('sw_portstats?portid=ALL', 'get')
	}

	startSwitchPoll() {
		this.stopSwitchPoll()

		this.switchPoll = setInterval(() => {
			this.getSwitchInfo()
		}, 1000)

		//Token expires every 24hrs
		this.tokenReAuth = setInterval(
			() => {
				this.initConnection()
			},
			24 * 60 * 60 * 1000,
		)
	}

	stopSwitchPoll() {
		if (this.switchPoll) {
			clearInterval(this.switchPoll)
			delete this.switchPoll
		}
		if (this.tokenReAuth) {
			clearInterval(this.tokenReAuth)
			delete this.tokenReAuth
		}
	}

	sendCommand(cmd, type, params) {
		let url = `https://${this.config.host}:8443/api/v1/${cmd}`
		let options = {}
		if (type == 'PUT' || type == 'POST') {
			options = {
				method: type,
				body: params != undefined ? JSON.stringify(params) : null,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.switch.token}` },
				agent: this.httpsAgent,
			}
		} else {
			options = {
				method: type,
				body: params != undefined ? JSON.stringify(params) : null,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.switch.token}` },
				agent: this.httpsAgent,
			}
		}

		fetch(url, options)
			.then((res) => {
				if (res.status == 200) {
					return res.json()
				}
			})

			.then((json) => {
				let data = json
				if (data) {
					this.processData(cmd, data)
				}
			})
			.catch((error) => {
				this.log('debug', error)
			})
	}

	processData(cmd, data) {
		if (cmd.match('device_info')) {
			this.switch.deviceInfo = data.deviceInfo
			let info = data.deviceInfo

			this.setVariableValues({
				active_ports: info.numOfActivePorts,
				memory_usage: info.memoryUsage,
				cpu_usage: info.cpuUsage,
				uptime: info.upTime,
			})
		} else if (cmd.match('sw_portstats')) {
			if (data.switchStatsPort) {
				if (!this.switch.switchStatsPort) {
					this.switch.switchStatsPort = data.switchStatsPort
					this.initPresets()
					this.initVariables()
					let changedVars = {}
					data.switchStatsPort.forEach((port) => {
						let id = port.portId
						let portSpeed = CONSTANTS.speedStatusLevels[`${port.speed}`]
						changedVars[`port_${id}_speed`] = portSpeed
						changedVars[`port_${id}_vlans`] = port.vlans
					})
					this.setVariableValues(changedVars)
					this.checkFeedbacks('linkStatus')
				} else {
					let changedVars = {}
					data.switchStatsPort.forEach((port) => {
						let id = port.portId
						let oldPort = this.switch?.switchStatsPort?.find(({ portId }) => portId === port.portId)

						if (!oldPort || oldPort?.speed !== port.speed) {
							let portSpeed = CONSTANTS.speedStatusLevels[`${port.speed}`]
							changedVars[`port_${id}_speed`] = portSpeed
						}
						if (!oldPort || oldPort?.vlans !== port.vlans) {
							changedVars[`port_${id}_vlans`] = port.vlans
						}
					})
					this.switch.switchStatsPort = data.switchStatsPort
					this.setVariableValues(changedVars)
					this.checkFeedbacks('linkStatus')
				}
			}
		} else if (cmd.match('swcfg_poe')) {
			if (data.poePortConfig) {
				if (!this.switch.poePortConfig) {
					this.switch.poePortConfig = data.poePortConfig
					this.initPresets()
					this.initVariables()
					let changedVars = {}
					data.poePortConfig.forEach((port) => {
						let id = port.portid
						let poeStatus = CONSTANTS.poeStatusLevels[`${port.status}`]
						let poePower = port.currentPower / 1000

						changedVars[`port_${id}_poe_status`] = poeStatus
						changedVars[`port_${id}_poe_current_power`] = `${poePower} W`
					})
					this.setVariableValues(changedVars)
					this.checkFeedbacks('poeEnabled')
				} else {
					let changedVars = {}
					data.poePortConfig.forEach((port) => {
						let id = port.portid
						let poeStatus = CONSTANTS.poeStatusLevels[`${port.status}`]
						let poePower = port.currentPower / 1000

						let oldPort = this.switch.poePortConfig?.find(({ portId }) => portId === port.portId)

						if (!oldPort || oldPort?.status !== port.status) {
							changedVars[`port_${id}_poe_status`] = poeStatus
						}
						if (!oldPort || oldPort?.currentPower !== port.currentPower) {
							changedVars[`port_${id}_poe_current_power`] = `${poePower} W`
						}
					})
					this.switch.poePortConfig = data.poePortConfig
					this.setVariableValues(changedVars)
					this.checkFeedbacks('poeEnabled')
				}
			}
		}
	}
}

runEntrypoint(ModuleInstance, upgradeScripts)
