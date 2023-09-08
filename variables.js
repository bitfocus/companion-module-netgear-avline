export function getVariables() {
	const variables = []

	variables.push({
		name: 'Active Ports',
		variableId: 'active_ports',
	})

	variables.push({
		name: 'Memory Usage',
		variableId: 'memory_usage',
	})

	variables.push({
		name: 'CPU Usage',
		variableId: 'cpu_usage',
	})

	variables.push({
		name: 'Uptime',
		variableId: 'uptime',
	})

	for (let x of this.switch.switchStatsPort) {
		let id = this.switch.switchStatsPort[x].portId
		variables.push({
			name: `Port ${id} - Speed`,
			variableId: `port_${id}_speed`,
		})
	}

	for (let x of this.switch.poePortConfig) {
		let id = this.switch.poePortConfig[x].portid
		variables.push({
			name: `Port ${id} - POE Status`,
			variableId: `port_${id}_poe_status`,
		})
		variables.push({
			name: `Port ${id} - POE Draw`,
			variableId: `port_${id}_poe_draw`,
		})
	}

	return variables
}
