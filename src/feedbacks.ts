import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import { fibrePortField, poePortField, portField, vlanField } from './fields.js'
import { fibreModules, type ModuleInstance } from './main.js'

export function getFeedbackDefinitions(self: ModuleInstance): CompanionFeedbackDefinitions {
	const ColorGreen = combineRgb(0, 200, 0)
	const ColorRed = combineRgb(200, 0, 0)

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
		poeDelivering: {
			type: 'boolean',
			name: 'POE Delivering Power',
			description: 'Change style if the port is actually delivering power, rather than just being enabled',
			defaultStyle: {
				bgcolor: ColorGreen,
			},
			options: [poePortField(self)],
			callback: (feedback) => {
				const port = self.poe_status?.get_port_configuration(Number(feedback.options.port))
				return port?.status === PoeStatusDelivering
			},
		},
		poeFault: {
			type: 'boolean',
			name: 'POE Fault',
			description: 'Change style if the port reports a PoE fault or overload',
			defaultStyle: {
				bgcolor: ColorRed,
			},
			options: [poePortField(self)],
			callback: (feedback) => {
				const port = self.poe_status?.get_port_configuration(Number(feedback.options.port))
				return port !== undefined && poeFaultStatuses.includes(port.status)
			},
		},
		sfpFault: {
			type: 'boolean',
			name: 'SFP Fault',
			description: 'Change style if the transceiver reports a fault',
			defaultStyle: {
				bgcolor: ColorRed,
			},
			options: [fibrePortField(self)],
			callback: (feedback) => {
				const module = fibreModules(self.fiber_optics).find((module) => module.port === feedback.options.port)
				return module !== undefined && isFibreFault(module.faultStatus)
			},
		},
	}
}

/* `Delivering Power`, and the statuses that mean the port has a problem – see `poeStatusLevels` */
const PoeStatusDelivering = 2
const poeFaultStatuses = [4, 5, 7]

/*
 * Fault status arrives as free text (`No Fault` on a healthy module), so anything that isn't a
 * recognised healthy value is treated as a fault rather than guessed at.
 */
function isFibreFault(faultStatus: string | undefined): boolean {
	if (faultStatus === undefined) return false

	const normalised = faultStatus.trim().toLowerCase()
	return normalised !== '' && normalised !== 'no fault' && normalised !== 'none' && normalised !== 'normal'
}
