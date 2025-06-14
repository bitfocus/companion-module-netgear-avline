export default function (self) {
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
	if (self.port_stats) {
		self.port_stats.all().forEach((port) => {
			let id = port.portId
			variables.push({
				name: `Port ${id} - Speed`,
				variableId: `port_${id}_speed`,
			})
			variables.push({
				name: `Port ${id} - VLANS`,
				variableId: `port_${id}_vlans`,
			})
		})
	}
	if (self.poe_status) {
		self.poe_status.all().forEach((port) => {
			let id = port.portid
			variables.push({
				name: `Port ${id} - POE Status`,
				variableId: `port_${id}_poe_status`,
			})
			variables.push({
				name: `Port ${id} - POE Draw`,
				variableId: `port_${id}_poe_current_power`,
			})
		})
	}
	self.setVariableDefinitions(variables)
}
