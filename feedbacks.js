import { combineRgb } from '@companion-module/base'

export default function (self) {
	const feedbacks = {}

	const ColorWhite = combineRgb(255, 255, 255)
	const ColorBlack = combineRgb(0, 0, 0)
	const ColorRed = combineRgb(200, 0, 0)
	const ColorGreen = combineRgb(0, 200, 0)
	const ColorOrange = combineRgb(255, 102, 0)

	;(feedbacks['poeEnabled'] = {
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
			},
		],
		callback: async (feedback) => {
			if (self.poe_status && self.poe_status.has(feedback.options.port)) {
				const port = self.poe_status.get_port_configuration(feedback.options.port)
				return port.enable
			}

			return undefined
		},
	}),
		(feedbacks['linkStatus'] = {
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
				},
			],
			callback: async (feedback) => {
				if (self.port_stats && self.port_stats.has(feedback.options.port)) {
					const port = self.port_stats.get_port_stats(feedback.options.port)
					return port.status === 0
				}

				return undefined
			},
		})

	self.setFeedbackDefinitions(feedbacks)
}
