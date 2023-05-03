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

	return variables
}
