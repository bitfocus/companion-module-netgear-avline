export function getActions() {
	let poeChoices = [
		{ id: 'toggle', label: 'Toggle' },
		{ id: true, label: 'Enable' },
		{ id: false, label: 'Disable' },
	]
	return {
		setPoeEnabled: {
			name: 'Set POE',
			options: [
				{
					type: 'dropdown',
					label: 'POE',
					id: 'enabled',
					default: true,
					choices: poeChoices,
				},
				{
					type: 'number',
					label: 'Port',
					id: 'port',
					default: 1,
					min: 1,
				},
			],
			callback: (action) => {
				let portInfo = this.switch?.poePortConfig?.find(({ portid }) => portid === action.options.port)

				if (portInfo) {
					let body = portInfo
					let state

					if (action.options.enabled === 'toggle') {
						state = body.enable === true ? false : true
					} else {
						state = action.options.enabled
					}
					body.enable = state
					this.sendCommand(`swcfg_poe?portid=${action.options.port}`, 'POST', { poePortConfig: body })
				}
			},
		},
		powerCyclePoe: {
			name: 'Power Cycle POE',
			options: [
				{
					type: 'number',
					label: 'Port',
					id: 'port',
					default: 1,
					min: 1,
				},
			],
			callback: (action) => {
				let portInfo = this.switch?.poePortConfig?.find(({ portid }) => portid === action.options.port)
				console.log(portInfo)
				if (portInfo) {
					let body = portInfo
					body.reset = true
					this.sendCommand(`swcfg_poe?portid=${action.options.port}`, 'POST', { poePortConfig: body })
				}
			},
		},
		reboot: {
			name: 'Reboot Switch',
			options: [],
			callback: () => {
				this.sendCommand('device_reboot', 'POST', {
					deviceReboot: {
						afterSecs: 2,
					},
				})
			},
		},
	}
}
