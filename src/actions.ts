import type { CompanionActionDefinitions } from '@companion-module/base'
import { ForbiddenError } from './switch.js'
import { portField, portsField, vlanField } from './fields.js'
import { parsePortSpec } from './ports.js'
import type { ModuleInstance } from './main.js'

const VLAN_MODES = ['access', 'tagged', 'pvid', 'remove']

const PRIVILEGE_HINT =
	"The switch's REST API expects the admin account; an account with fewer privileges can log in but cannot make changes."

/*
 * Run the switch calls behind an action, reporting anything that goes wrong in the module log.
 *
 * Companion would otherwise surface a rejected action as a bare error with a stack trace. A
 * refusal on grounds of privilege gets an explanation, because the usual cause is the connection
 * being configured with an account that can sign in but not make changes.
 *
 * Returns whether the calls succeeded, so that an action made of several writes can stop rather
 * than carrying on from a failed one.
 */
async function runAction(self: ModuleInstance, run: () => Promise<void>): Promise<boolean> {
	try {
		await run()
		return true
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		self.log('error', error instanceof ForbiddenError ? `${message}. ${PRIVILEGE_HINT}` : message)
		return false
	}
}

export function getActionDefinitions(self: ModuleInstance): CompanionActionDefinitions {
	const poeChoices = [
		{ id: 'toggle', label: 'Toggle' },
		{ id: 'true', label: 'Enable' },
		{ id: 'false', label: 'Disable' },
	]

	/*
	 * Expand the port specification and drop anything that can't take PoE, so the user gets a clear
	 * reason rather than whatever the switch makes of the request. `all` on a switch with a mix of
	 * port types means every PoE port, not every port.
	 */
	const poePorts = (options: Record<string, unknown>): number[] => {
		const poeCapable = self.poePortIds()

		let requested: number[]
		try {
			requested = parsePortSpec(typeof options.ports === 'string' ? options.ports : '', poeCapable)
		} catch (error) {
			self.log('error', `Cannot read the port list: ${error instanceof Error ? error.message : String(error)}`)
			return []
		}

		const usable = requested.filter((port) => self.isPoePort(port))
		const skipped = requested.filter((port) => !usable.includes(port))

		if (skipped.length > 0) {
			self.log('warn', `Skipping ${skipped.length} ${skipped.length === 1 ? 'port' : 'ports'} that cannot take POE`)
		}

		if (usable.length === 0) self.log('error', 'No POE capable ports in that port list')

		return usable
	}

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
				portsField(),
			],
			callback: async (action) => {
				const ports = poePorts(action.options)
				if (ports.length === 0) return

				await runAction(self, async () => {
					switch (action.options.enabled) {
						case 'true':
							await self.switch.enable_poe_ports(ports)
							break
						case 'false':
							await self.switch.disable_poe_ports(ports)
							break
						case 'toggle':
							await self.switch.toggle_poe_ports(ports)
							break
					}
				})

				self.refreshNow()
			},
		},
		powerCyclePoe: {
			name: 'Power Cycle POE',
			options: [portsField()],
			callback: async (action) => {
				const ports = poePorts(action.options)
				if (ports.length === 0) return

				await runAction(self, async () => self.switch.power_cycle_poe_ports(ports))
				self.refreshNow()
			},
		},
		setPortEnabled: {
			name: 'Set Port Enabled',
			description: 'Enable or disable a physical port',
			options: [
				{
					type: 'dropdown',
					label: 'State',
					id: 'enabled',
					default: 'true',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'true', label: 'Enable' },
						{ id: 'false', label: 'Disable' },
					],
				},
				portField(self),
			],
			callback: async (action) => {
				const port = Number(action.options.port)
				const current = self.port_config?.get_port_configuration(port)

				let enabled: boolean
				if (action.options.enabled === 'toggle') {
					if (current?.adminMode === undefined) {
						self.log('error', `Port ${port} state is unknown, cannot toggle it`)
						return
					}
					enabled = !current.adminMode
				} else {
					enabled = action.options.enabled === 'true'
				}

				await runAction(self, async () => self.switch.set_port_admin_mode(port, enabled))
				await self.refreshPortConfig(port)
			},
		},
		setPortVlan: {
			name: 'Set Port VLAN',
			description:
				"Put a port on a VLAN. 'Untagged' is the usual choice for an endpoint: it makes the port an untagged member and points the port's own traffic at that VLAN. 'PVID only' is for a port that already belongs to the VLAN.",
			options: [
				portField(self),
				vlanField(),
				{
					type: 'dropdown',
					label: 'Mode',
					id: 'mode',
					default: 'access',
					choices: [
						{ id: 'access', label: 'Untagged' },
						{ id: 'tagged', label: 'Tagged' },
						{ id: 'pvid', label: 'Set VLAN (PVID) only' },
						{ id: 'remove', label: 'Remove from VLAN' },
					],
				},
			],
			callback: async (action) => {
				const port = Number(action.options.port)
				const vlan = Number(action.options.vlan)
				const mode = String(action.options.mode)

				if (!VLAN_MODES.includes(mode)) {
					self.log('error', `Unknown VLAN mode '${mode}'`)
					return
				}

				// Membership is written before the port's own VLAN, because a switch can refuse to
				// point a port at a VLAN it isn't a member of
				if (mode === 'tagged' || mode === 'access') {
					const written = await runAction(self, async () =>
						self.switch.set_vlan_membership(port, vlan, mode === 'tagged' ? 'tagged' : 'untagged'),
					)

					// Pointing the port at a VLAN it failed to join would leave it stranded
					if (!written) {
						await self.refreshPortConfig(port)
						return
					}
				}

				if (mode === 'remove') {
					const current = self.port_config?.get_port_configuration(port)
					if (current?.portVlanId === vlan) {
						self.log(
							'warn',
							`Port ${port} still has VLAN ${vlan} as its own VLAN; set that to another VLAN or its traffic has nowhere to go`,
						)
					}

					await runAction(self, async () => self.switch.set_vlan_membership(port, vlan, 'excluded'))
				}

				if (mode === 'access' || mode === 'pvid') {
					await runAction(self, async () => self.switch.set_port_vlan(port, vlan))
				}

				await self.refreshPortConfig(port)
				self.refreshNow()
			},
		},
		saveConfiguration: {
			name: 'Save Configuration',
			description:
				'Copy the running configuration to the startup configuration. POE changes made by this module are otherwise lost when the switch restarts.',
			options: [],
			callback: async () => {
				await runAction(self, async () => self.switch.save_configuration())
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
				await runAction(self, async () => {
					if (action.options.save) await self.switch.save_configuration()
					await self.switch.power_cycle_switch()
				})
			},
		},
	}
}
