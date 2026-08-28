import {
	combineRgb,
	type CompanionButtonPresetDefinition,
	type CompanionPresetDefinitions,
	type CompanionTextPresetDefinition,
} from '@companion-module/base'
import { fiberVariableId } from './main.js'
import type { ModuleInstance } from './main.js'
import { temperatureSensors } from './types.js'

/*
 * Presets refer to this module's variables by the default connection label; Companion rewrites it
 * to the real label when the preset is added to a button.
 */
const LABEL = 'avline'

const ColorWhite = combineRgb(255, 255, 255)
const ColorBlack = combineRgb(0, 0, 0)
const ColorGreen = combineRgb(0, 200, 0)
const ColorDarkGrey = combineRgb(32, 32, 32)

export function getPresetDefinitions(self: ModuleInstance): CompanionPresetDefinitions {
	const presets: CompanionPresetDefinitions = {}

	for (const port of self.poe_status?.all() ?? []) {
		presets[`poe_${port.portid}`] = {
			type: 'button',
			category: 'POE',
			name: `POE Port ${port.portid}`,
			options: {},
			style: {
				text: `POE\\nPort ${port.portid}`,
				size: '14',
				color: ColorWhite,
				bgcolor: ColorBlack,
			},
			steps: [
				{
					down: [
						{
							actionId: 'setPoeEnabled',
							options: {
								enabled: 'toggle',
								ports: String(port.portid),
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'poeEnabled',
					options: {
						port: port.portid,
					},
					style: {
						bgcolor: ColorGreen,
					},
				},
			],
		}
	}

	for (const port of self.port_stats?.all() ?? []) {
		presets[`link_${port.portId}`] = {
			type: 'button',
			category: 'Link Status',
			name: `Link Status Port ${port.portId}`,
			options: {},
			style: {
				text: `Link\\nPort ${port.portId}`,
				size: '14',
				color: ColorWhite,
				bgcolor: ColorBlack,
			},
			steps: [
				{
					down: [],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'linkStatus',
					options: {
						port: port.portId,
					},
					style: {
						bgcolor: ColorGreen,
					},
				},
			],
		}
	}

	addPortStatusPresets(self, presets)
	addSwitchStatusPresets(self, presets)
	addTransceiverPresets(self, presets)

	return presets
}

/*
 * One group per port, introduced by a text preset so that a 48 port switch reads as a list of
 * ports rather than several hundred undifferentiated buttons.
 */
function addPortStatusPresets(self: ModuleInstance, presets: CompanionPresetDefinitions): void {
	const ports = self.port_config?.all().map((port) => port.ID) ?? (self.port_stats?.all() ?? []).map((p) => p.portId)

	for (const port of ports.sort((a, b) => a - b)) {
		presets[`port_${port}_header`] = header('Port Status', `Port ${port}`)

		presets[`port_${port}_speed`] = status('Port Status', `Port ${port} Speed`, [
			`P${port} Speed`,
			`$(${LABEL}:port_${port}_speed)`,
		])

		presets[`port_${port}_bandwidth`] = status('Port Status', `Port ${port} Bandwidth`, [
			`P${port} Mbps`,
			`$(${LABEL}:port_${port}_rx_mbps) Up`,
			`$(${LABEL}:port_${port}_tx_mbps) Down`,
		])

		presets[`port_${port}_vlan_status`] = status('Port Status', `Port ${port} VLAN`, [
			`P${port} VLAN`,
			`$(${LABEL}:port_${port}_access_vlan)`,
			`$(${LABEL}:port_${port}_vlans)`,
		])

		presets[`port_${port}_neighbour`] = status('Port Status', `Port ${port} LLDP`, [
			`P${port}`,
			`$(${LABEL}:port_${port}_lldp_system_name)`,
		])

		if (self.isPoePort(port)) {
			presets[`port_${port}_poe_status`] = status('Port Status', `Port ${port} POE Draw`, [
				`P${port} POE`,
				`$(${LABEL}:port_${port}_poe_status)`,
				`$(${LABEL}:port_${port}_poe_current_power)`,
			])
		}

		// The only preset in this group that does something: the rest are read-outs
		presets[`port_${port}_enabled`] = {
			type: 'button',
			category: 'Port Status',
			name: `Port ${port} Enable/Disable`,
			options: {},
			style: {
				text: `P${port}\\n$(${LABEL}:port_${port}_admin_mode)`,
				size: 'auto',
				color: ColorWhite,
				bgcolor: ColorBlack,
			},
			steps: [
				{
					down: [{ actionId: 'setPortEnabled', options: { enabled: 'toggle', port } }],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: 'portEnabled', options: { port }, style: { bgcolor: ColorGreen } }],
		}
	}
}

function addSwitchStatusPresets(self: ModuleInstance, presets: CompanionPresetDefinitions): void {
	presets['switch_header'] = header('Switch Status', 'Switch')

	presets['switch_device'] = status('Switch Status', 'Model', [`$(${LABEL}:model)`, `$(${LABEL}:firmware_version)`])
	presets['switch_uptime'] = status('Switch Status', 'Uptime', ['Uptime', `$(${LABEL}:uptime)`])
	presets['switch_cpu'] = status('Switch Status', 'CPU Usage', ['CPU', `$(${LABEL}:cpu_usage)`])
	presets['switch_memory'] = status('Switch Status', 'Memory Usage', ['Memory', `$(${LABEL}:memory_usage)`])
	presets['switch_active_ports'] = status('Switch Status', 'Active Ports', [
		'Ports',
		`$(${LABEL}:active_ports)/$(${LABEL}:total_ports)`,
	])
	presets['switch_poe_usage'] = status('Switch Status', 'POE Consumption', ['POE', `$(${LABEL}:poe_total_consumption)`])

	for (const sensor of self.device_status ? temperatureSensors(self.device_status) : []) {
		const number = sensor.sensorNum
		presets[`switch_temperature_${number}`] = status('Switch Status', `Temperature ${sensor.sensorDesc ?? number}`, [
			'Temp',
			`$(${LABEL}:temperature_${number})°C`,
			`$(${LABEL}:temperature_${number}_state)`,
		])
	}

	presets['switch_save'] = {
		type: 'button',
		category: 'Switch Status',
		name: 'Save Configuration',
		options: {},
		style: { text: 'Save\\nConfig', size: '14', color: ColorWhite, bgcolor: ColorBlack },
		steps: [{ down: [{ actionId: 'saveConfiguration', options: {} }], up: [] }],
		feedbacks: [],
	}
}

/** One group per transceiver, again introduced by a header */
function addTransceiverPresets(self: ModuleInstance, presets: CompanionPresetDefinitions): void {
	for (const module of self.fiber_optics) {
		const id = fiberVariableId(module.port)

		presets[`sfp_${id}_header`] = header('SFP Modules', `SFP ${module.port}`)

		presets[`sfp_${id}_temperature`] = status('SFP Modules', `SFP ${module.port} Temperature`, [
			`SFP ${module.port}`,
			`$(${LABEL}:sfp_${id}_temperature)°C`,
		])
		presets[`sfp_${id}_power`] = status('SFP Modules', `SFP ${module.port} Power`, [
			`SFP ${module.port}`,
			`↓$(${LABEL}:sfp_${id}_input_power)`,
			`↑$(${LABEL}:sfp_${id}_output_power)`,
		])
		presets[`sfp_${id}_signal`] = status('SFP Modules', `SFP ${module.port} Signal`, [
			`SFP ${module.port}`,
			`LOS $(${LABEL}:sfp_${id}_loss_of_signal)`,
			`$(${LABEL}:sfp_${id}_fault_status)`,
		])
	}
}

function header(category: string, name: string): CompanionTextPresetDefinition {
	return { type: 'text', category, name, text: '' }
}

/** A read-only button: no actions, no feedbacks, just variables */
function status(category: string, name: string, lines: string[]): CompanionButtonPresetDefinition {
	return {
		type: 'button',
		category,
		name,
		options: {},
		style: {
			text: lines.join('\\n'),
			size: 'auto',
			color: ColorWhite,
			bgcolor: ColorDarkGrey,
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [],
	}
}
