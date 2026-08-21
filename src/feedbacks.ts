import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import { poePortField, portField, vlanField } from './fields.js'
import type { ModuleInstance } from './main.js'

export function getFeedbackDefinitions(self: ModuleInstance): CompanionFeedbackDefinitions {
	const ColorGreen = combineRgb(0, 200, 0)

	return {
		poeEnabled: {
			type: 'boolean',
			name: 'POE Enabled',
			description: 'Change style if port has POE enabled',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [poePortField(self)],
			callback: (feedback) => {
				const port = self.poe_status?.get_port_configuration(Number(feedback.options.port))
				return port?.enable ?? false
			},
		},
		portEnabled: {
			type: 'boolean',
			name: 'Port Enabled',
			description: 'Change style if the physical port is enabled',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [portField(self)],
			callback: (feedback) => {
				const port = self.port_config?.get_port_configuration(Number(feedback.options.port))
				return port?.adminMode ?? false
			},
		},
		portVlan: {
			type: 'boolean',
			name: 'Port VLAN',
			description: 'Change style if the port is on a particular VLAN',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [portField(self), vlanField()],
			callback: (feedback) => {
				const port = self.port_config?.get_port_configuration(Number(feedback.options.port))
				return port?.portVlanId === Number(feedback.options.vlan)
			},
		},
		linkStatus: {
			type: 'boolean',
			name: 'Link Status',
			description: 'Change style if port has active link',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [portField(self)],
			callback: (feedback) => {
				const port = self.port_stats?.get_port_stats(Number(feedback.options.port))
				return port !== undefined && port.status === 0
			},
		},
	}
}
