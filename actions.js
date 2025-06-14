export default function (self) {
	let poeChoices = [
		{ id: 'toggle', label: 'Toggle' },
		{ id: true, label: 'Enable' },
		{ id: false, label: 'Disable' },
	]

	self.setActionDefinitions({
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
			callback: async (action) => {
				switch (action.options.enabled) {
					case true:
						await self.switch.enable_poe_ports([action.options.port])
						break
					case false:
						await self.switch.disable_poe_ports([action.options.port])
						break
					case 'toggle':
						await self.switch.toggle_poe_ports([action.options.port])
						break
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
			callback: async (action) => {
				await self.switch.power_cycle_poe_ports([action.options.port])
			},
		},
		reboot: {
			name: 'Reboot Switch',
			options: [],
			callback: async (action) => {
				await self.switch.power_cycle_switch()
			},
		},
	})
}
