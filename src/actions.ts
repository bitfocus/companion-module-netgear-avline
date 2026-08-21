import type { CompanionActionDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

export function getActionDefinitions(self: ModuleInstance): CompanionActionDefinitions {
	const poeChoices = [
		{ id: 'toggle', label: 'Toggle' },
		{ id: 'true', label: 'Enable' },
		{ id: 'false', label: 'Disable' },
	]

	return {
		setPoeEnabled: {
			name: 'Set POE',
			options: [
				{
					type: 'dropdown',
					label: 'POE',
					id: 'enabled',
					default: 'true',
					choices: poeChoices,
				},
				{
					type: 'number',
					label: 'Port',
					id: 'port',
					default: 1,
					min: 1,
					max: 64,
				},
			],
			callback: async (action) => {
				const port = Number(action.options.port)

				switch (action.options.enabled) {
					case 'true':
					case true:
						await self.switch.enable_poe_ports([port])
						break
					case 'false':
					case false:
						await self.switch.disable_poe_ports([port])
						break
					case 'toggle':
						await self.switch.toggle_poe_ports([port])
						break
				}

				self.refreshNow()
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
					max: 64,
				},
			],
			callback: async (action) => {
				await self.switch.power_cycle_poe_ports([Number(action.options.port)])
				self.refreshNow()
			},
		},
		saveConfiguration: {
			name: 'Save Configuration',
			description:
				'Copy the running configuration to the startup configuration. POE changes made by this module are otherwise lost when the switch restarts.',
			options: [],
			callback: async () => {
				await self.switch.save_configuration()
			},
		},
		reboot: {
			name: 'Reboot Switch',
			description: 'Restart the switch. Unsaved changes to the running configuration are lost.',
			options: [
				{
					type: 'checkbox',
					label: 'Save configuration first',
					id: 'save',
					default: true,
				},
			],
			callback: async (action) => {
				if (action.options.save) await self.switch.save_configuration()
				await self.switch.power_cycle_switch()
			},
		},
	}
}
