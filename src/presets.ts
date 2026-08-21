import { combineRgb, type CompanionPresetDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

export function getPresetDefinitions(self: ModuleInstance): CompanionPresetDefinitions {
	const ColorWhite = combineRgb(255, 255, 255)
	const ColorBlack = combineRgb(0, 0, 0)
	const ColorGreen = combineRgb(0, 200, 0)

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
								port: port.portid,
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

	return presets
}
