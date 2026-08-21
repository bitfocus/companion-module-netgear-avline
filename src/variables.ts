import type { CompanionVariableDefinition } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { temperatureSensors } from './types.js'

export function getVariableDefinitions(self: ModuleInstance): CompanionVariableDefinition[] {
	const variables: CompanionVariableDefinition[] = [
		{ name: 'Active Ports', variableId: 'active_ports' },
		{ name: 'Memory Usage', variableId: 'memory_usage' },
		{ name: 'CPU Usage', variableId: 'cpu_usage' },
		{ name: 'Uptime', variableId: 'uptime' },
		{ name: 'Device Name', variableId: 'device_name' },
		{ name: 'Model', variableId: 'model' },
		{ name: 'Serial Number', variableId: 'serial_number' },
		{ name: 'Firmware Version', variableId: 'firmware_version' },
		{ name: 'Total Ports', variableId: 'total_ports' },
		{ name: 'Last Reboot', variableId: 'last_reboot' },
		{ name: 'Fan State', variableId: 'fan_state' },
		{ name: 'POE Budget', variableId: 'poe_budget' },
		{ name: 'POE Total Consumption', variableId: 'poe_total_consumption' },
		{ name: 'POE Main Status', variableId: 'poe_main_status' },
		{ name: 'POE Power Management Mode', variableId: 'poe_power_management_mode' },
	]

	if (self.device_status) {
		for (const sensor of temperatureSensors(self.device_status)) {
			const label = sensor.sensorDesc ?? `Sensor ${sensor.sensorNum}`
			variables.push({ name: `Temperature - ${label}`, variableId: `temperature_${sensor.sensorNum}` })
			variables.push({ name: `Temperature - ${label} - State`, variableId: `temperature_${sensor.sensorNum}_state` })
		}
	}

	for (const port of self.port_stats?.all() ?? []) {
		variables.push({ name: `Port ${port.portId} - Speed`, variableId: `port_${port.portId}_speed` })
		variables.push({ name: `Port ${port.portId} - VLANS`, variableId: `port_${port.portId}_vlans` })
	}

	for (const port of self.poe_status?.all() ?? []) {
		variables.push({ name: `Port ${port.portid} - POE Status`, variableId: `port_${port.portid}_poe_status` })
		variables.push({ name: `Port ${port.portid} - POE Draw`, variableId: `port_${port.portid}_poe_current_power` })
	}

	return variables
}
