import type { CompanionVariableDefinition } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { fiberVariableId, fibreModules } from './main.js'
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
		{ name: 'Fan State', variableId: 'fan_state' },
		{ name: 'Device RX Bytes', variableId: 'device_rx_bytes' },
		{ name: 'Device TX Bytes', variableId: 'device_tx_bytes' },
		{ name: 'POE Total Consumption', variableId: 'poe_total_consumption' },
		{ name: 'POE Total Consumption (Watts)', variableId: 'poe_total_consumption_watts' },
		{ name: 'POE Usage Threshold (%)', variableId: 'poe_usage_threshold' },
		{ name: 'POE Main Status', variableId: 'poe_main_status' },
		{ name: 'POE Power Management Mode', variableId: 'poe_power_management_mode' },
		{ name: 'POE Capable Ports', variableId: 'poe_ports' },
	]

	for (const module of fibreModules(self.fiber_optics)) {
		const id = fiberVariableId(module.port)
		const label = `SFP ${module.port}`

		variables.push({ name: `${label} - Temperature`, variableId: `sfp_${id}_temperature` })
		variables.push({ name: `${label} - Voltage`, variableId: `sfp_${id}_voltage` })
		variables.push({ name: `${label} - Current`, variableId: `sfp_${id}_current` })
		variables.push({ name: `${label} - Input Power`, variableId: `sfp_${id}_input_power` })
		variables.push({ name: `${label} - Output Power`, variableId: `sfp_${id}_output_power` })
		variables.push({ name: `${label} - Loss Of Signal`, variableId: `sfp_${id}_loss_of_signal` })
		variables.push({ name: `${label} - TX Fault`, variableId: `sfp_${id}_tx_fault` })
		variables.push({ name: `${label} - Fault Status`, variableId: `sfp_${id}_fault_status` })
		variables.push({ name: `${label} - Vendor`, variableId: `sfp_${id}_vendor` })
		variables.push({ name: `${label} - Part Number`, variableId: `sfp_${id}_part_number` })
		variables.push({ name: `${label} - Serial Number`, variableId: `sfp_${id}_serial_number` })
	}

	// LLDP neighbours come and go, so every port gets variables whether or not one is present
	for (let port = 1; port <= self.portCount(); port++) {
		variables.push({ name: `Port ${port} - LLDP System Name`, variableId: `port_${port}_lldp_system_name` })
		variables.push({ name: `Port ${port} - LLDP Port ID`, variableId: `port_${port}_lldp_port_id` })
		variables.push({ name: `Port ${port} - LLDP Port Description`, variableId: `port_${port}_lldp_port_description` })
		variables.push({ name: `Port ${port} - LLDP Chassis ID`, variableId: `port_${port}_lldp_chassis_id` })
		variables.push({
			name: `Port ${port} - LLDP System Description`,
			variableId: `port_${port}_lldp_system_description`,
		})
	}

	for (const port of self.port_config?.all() ?? []) {
		variables.push({ name: `Port ${port.ID} - Description`, variableId: `port_${port.ID}_description` })
		variables.push({ name: `Port ${port.ID} - POE Capable`, variableId: `port_${port.ID}_poe_capable` })
		variables.push({ name: `Port ${port.ID} - Admin Mode`, variableId: `port_${port.ID}_admin_mode` })
		variables.push({ name: `Port ${port.ID} - Access VLAN`, variableId: `port_${port.ID}_access_vlan` })
	}

	if (self.device_status) {
		for (const sensor of temperatureSensors(self.device_status)) {
			const label = sensor.sensorDesc ?? `Sensor ${sensor.sensorNum}`
			variables.push({ name: `Temperature - ${label}`, variableId: `temperature_${sensor.sensorNum}` })
			variables.push({ name: `Temperature - ${label} - State`, variableId: `temperature_${sensor.sensorNum}_state` })
		}
	}

	for (const port of self.port_stats?.all() ?? []) {
		variables.push({ name: `Port ${port.portId} - Link Status`, variableId: `port_${port.portId}_link_status` })
		variables.push({ name: `Port ${port.portId} - Speed`, variableId: `port_${port.portId}_speed` })
		variables.push({ name: `Port ${port.portId} - VLAN Membership`, variableId: `port_${port.portId}_vlans` })
		variables.push({ name: `Port ${port.portId} - RX (Mbps)`, variableId: `port_${port.portId}_rx_mbps` })
		variables.push({ name: `Port ${port.portId} - TX (Mbps)`, variableId: `port_${port.portId}_tx_mbps` })
		variables.push({ name: `Port ${port.portId} - RX Bytes`, variableId: `port_${port.portId}_rx_bytes` })
		variables.push({ name: `Port ${port.portId} - TX Bytes`, variableId: `port_${port.portId}_tx_bytes` })
	}

	for (const port of self.poe_status?.all() ?? []) {
		variables.push({ name: `Port ${port.portid} - POE Status`, variableId: `port_${port.portid}_poe_status` })
		variables.push({ name: `Port ${port.portid} - POE Draw`, variableId: `port_${port.portid}_poe_current_power` })
		variables.push({ name: `Port ${port.portid} - POE Enabled`, variableId: `port_${port.portid}_poe_enabled` })
		variables.push({ name: `Port ${port.portid} - POE Power Limit`, variableId: `port_${port.portid}_poe_power_limit` })
	}

	return variables
}
