import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
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
			options: [
				{
					type: 'number',
					label: 'Port',
					id: 'port',
					default: 1,
					min: 1,
					max: 64,
				},
			],
			callback: (feedback) => {
				const port = self.poe_status?.get_port_configuration(Number(feedback.options.port))
				return port?.enable ?? false
			},
		},
		linkStatus: {
			type: 'boolean',
			name: 'Link Status',
			description: 'Change style if port has active link',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [
				{
					type: 'number',
					label: 'Port',
					id: 'port',
					default: 1,
					min: 1,
					max: 64,
				},
			],
			callback: (feedback) => {
				const port = self.port_stats?.get_port_stats(Number(feedback.options.port))
				return port !== undefined && port.status === 0
			},
		},
	}
}
