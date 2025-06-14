import fetch from 'node-fetch'
import https from 'https'

class NetgearM4250 {
	constructor(url_or_ip_address, username, password) {
		this.url_or_ip_address = url_or_ip_address
		this.username = username
		this.password = password
		this.token = null

		this.httpsAgent = new https.Agent({
			rejectUnauthorized: false,
		})
	}

	async login() {
		const request = new LoginRequest(this.httpsAgent)
		const data = await request.fetch(this.url_or_ip_address, this.username, this.password)

		if (data.resp.status === 'success') {
			this.token = data.login.token
		} else {
			console.error(data.resp.respMsg)
			throw new Error(data.resp.respMsg)
		}

		this.loginExpiresAt = Date.now() + parseInt(data.login.expire) * 1000

		return true
	}

	/**
	 * Enable POE on a list of ports
	 * @param {number[]} ports - The ports to enable POE for
	 */
	async enable_poe_ports(ports) {
		const request = new POEStateChangeRequest(true, this.httpsAgent, this.token)

		const map = await this.get_port_poe_status()

		for (const port of ports) {
			await request.fetch(this.url_or_ip_address, port, map.get_port_configuration(port))
			console.log(`Enabled port ${port}`)
		}
	}

	/**
	 * Disable POE on a list of ports
	 * @param {number[]} ports - The ports to disable POE for
	 */
	async disable_poe_ports(ports) {
		const request = new POEStateChangeRequest(false, this.httpsAgent, this.token)

		const map = await this.get_port_poe_status()

		for (const port of ports) {
			await request.fetch(this.url_or_ip_address, port, map.get_port_configuration(port))
			console.log(`Disabled port ${port}`)
		}
	}

	/**
	 * Toggle POE on a list of ports
	 * @param {number[]} ports - The ports to toggle POE for
	 */
	async toggle_poe_ports(ports) {
		const status = await this.get_port_poe_status()

		for (const port of ports) {
			const port_config = status.get_port_configuration(port)
			if (port_config.enable) {
				await this.disable_poe_ports([port])
			} else {
				await this.enable_poe_ports([port])
			}
		}
	}

	/**
	 * Power cycle POE on a list of ports
	 * @param {number[]} ports - The ports to power cycle POE for
	 */
	async power_cycle_poe_ports(ports) {
		const request = new PoePowerCycleRequest(this.httpsAgent, this.token)
		const map = await this.get_port_poe_status()
		for (const port of ports) {
			await request.fetch(this.url_or_ip_address, port, map.get_port_configuration(port))
		}
	}

	async power_cycle_switch() {
		console.log('Power cycling switch')
		const request = new SwitchPowerCycleRequest(this.httpsAgent, this.token)
		const response = await request.fetch(this.url_or_ip_address)
		console.log(response)
	}

	async get_port_poe_status() {
		const request = new POEConfigRequest(this.httpsAgent, this.token)
		return await request.fetch(this.url_or_ip_address)
	}

	async port_has_link(port_number) {
		const stats = await this.get_port_stats()
		const port = stats.get_port_stats(port_number)
		// `130` is a magic number for "unknown" speed (ie – the link is down)
		return port.speed !== 130
	}

	async get_port_stats() {
		const request = new PortStatsRequest(this.httpsAgent, this.token)
		return await request.fetch(this.url_or_ip_address)
	}

	async get_device_name() {
		const response = await fetch(`https://${this.url_or_ip_address}:8443/api/v1/device_name`, {
			method: 'GET',
			agent: this.httpsAgent,
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
		})
		const json = await response.json()
		return json.deviceName.name
	}

	async get_device_status() {
		const response = await fetch(`https://${this.url_or_ip_address}:8443/api/v1/device_info`, {
			method: 'GET',
			agent: this.httpsAgent,
			headers: {
				Authorization: `Bearer ${this.token}`,
			},
		})

		const json = await response.json()
		return json.deviceInfo
	}
}

class POEStateChangeRequest {
	constructor(enable, httpsAgent, token) {
		this.enable = enable
		this.agent = httpsAgent
		this.headers = {
			Authorization: `Bearer ${token}`,
		}
	}

	async fetch(url_or_ip_address, port, config) {
		delete config.portid
		config.enable = this.enable

		return await fetch(`https://${url_or_ip_address}:8443/api/v1/swcfg_poe?portid=${port}`, {
			method: 'POST',
			agent: this.agent,
			headers: this.headers,
			body: JSON.stringify({
				poePortConfig: config,
			}),
		})
	}
}

class PoePowerCycleRequest {
	constructor(httpsAgent, token) {
		this.agent = httpsAgent
		this.headers = {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
		}
	}

	async fetch(url_or_ip_address, port, config) {
		delete config.portid
		config.reset = true

		return await fetch(`https://${url_or_ip_address}:8443/api/v1/swcfg_poe?portid=${port}`, {
			method: 'POST',
			agent: this.agent,
			headers: this.headers,
			body: JSON.stringify({
				poePortConfig: config,
			}),
		})
	}
}

class POEConfigRequest {
	constructor(httpsAgent, token) {
		this.agent = httpsAgent
		this.headers = {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
		}
	}

	async fetch(url_or_ip_address) {
		const response = await fetch(`https://${url_or_ip_address}:8443/api/v1/swcfg_poe?portid=ALL`, {
			method: 'GET',
			agent: this.agent,
			headers: this.headers,
			redirect: 'follow', // TODO: Need this?
		})

		return new PortPoeConfigurationMap(await response.json())
	}
}

class LoginRequest {
	constructor(httpsAgent) {
		this.agent = httpsAgent
	}

	async fetch(url_or_ip_address, username, password) {
		const body = {
			login: {
				username: username,
				password: password,
			},
		}

		const response = await fetch(`https://${url_or_ip_address}:8443/api/v1/login`, {
			method: 'POST',
			agent: this.agent,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(body),
		})

		const responseBody = await response.text()

		try {
			return JSON.parse(responseBody)
		} catch (error) {
			console.error(responseBody)
			throw new Error(responseBody)
		}
	}
}

class PortStatsRequest {
	constructor(httpsAgent, token) {
		this.agent = httpsAgent
		this.headers = {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
		}
	}

	async fetch(url_or_ip_address) {
		const response = await fetch(`https://${url_or_ip_address}:8443/api/v1/sw_portstats?portid=ALL`, {
			method: 'GET',
			agent: this.agent,
			headers: this.headers,
		})

		return new PortStatsMap(await response.json())
	}
}

class SwitchPowerCycleRequest {
	constructor(httpsAgent, token) {
		this.agent = httpsAgent
		this.headers = {
			Accept: 'application/json',
			Authorization: `Bearer ${token}`,
		}
	}

	async fetch(url_or_ip_address) {
		const body = {
			deviceReboot: {
				afterSecs: 2,
			},
		}

		const response = await fetch(`https://${url_or_ip_address}:8443/api/v1/device_reboot`, {
			method: 'POST',
			agent: this.agent,
			headers: this.headers,
			body: JSON.stringify(body),
		})

		const json = await response.json()
		console.log(json)

		return json.resp
	}
}

class PortPoeConfigurationMap {
	constructor(data) {
		this.data = data
	}

	all() {
		return this.data.poePortConfig
	}

	has(port_id) {
		return this.all().some((item) => item.portid === port_id)
	}

	get_port_configuration(port_id) {
		return this.all().find((item) => item.portid === port_id)
	}
}

class PortStatsMap {
	constructor(data) {
		this.data = data
	}

	all() {
		return this.data.switchStatsPort
	}

	has(port_id) {
		return this.all().some((item) => item.portId === port_id)
	}

	get_port_stats(port_id) {
		return this.all().find((item) => item.portId === port_id)
	}
}

export { NetgearM4250 }
