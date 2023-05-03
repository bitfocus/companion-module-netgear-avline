import { combineRgb } from '@companion-module/base'

export function getFeedbacks() {
	const feedbacks = {}

	const ColorWhite = combineRgb(255, 255, 255)
	const ColorBlack = combineRgb(0, 0, 0)
	const ColorRed = combineRgb(200, 0, 0)
	const ColorGreen = combineRgb(0, 200, 0)
	const ColorOrange = combineRgb(255, 102, 0)

	feedbacks['poeEnabled'] = {
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
		callback: (feedback) => {
			let portInfo = this.switch?.poePortConfig?.find(({ portid }) => portid === feedback.options.port)

			if (portInfo) {
				return portInfo.enable
			}
		},
	}
	feedbacks['linkStatus'] = {
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
		callback: (feedback) => {
			let portInfo = this.switch?.switchStatsPort?.find(({ portId }) => portId === feedback.options.port)

			if (portInfo) {
				return portInfo.status === 0 ? true : false
			}
		},
	}

	return feedbacks
}
