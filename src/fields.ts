import type { CompanionInputFieldNumber, CompanionInputFieldTextInput } from '@companion-module/base'

/** VLAN ids the switch accepts */
export const MIN_VLAN_ID = 1
export const MAX_VLAN_ID = 4093
import type { ModuleInstance } from './main.js'

/*
 * Port numbers are typed in rather than picked from a list, so the bounds are set from what the
 * switch reports – there is no point offering port 40 on a 12 port switch.
 */
export function portField(self: ModuleInstance): CompanionInputFieldNumber {
	return {
		type: 'number',
		label: 'Port',
		id: 'port',
		default: 1,
		min: 1,
		max: Math.max(self.portCount(), 1),
	}
}

/** As `portField`, but bounded to the range of ports that can deliver PoE */
export function poePortField(self: ModuleInstance): CompanionInputFieldNumber {
	const poePorts = self.poePortIds()
	if (poePorts.length === 0) return portField(self)

	return {
		type: 'number',
		label: 'Port',
		id: 'port',
		default: Math.min(...poePorts),
		min: Math.min(...poePorts),
		max: Math.max(...poePorts),
	}
}

export function vlanField(): CompanionInputFieldNumber {
	return {
		type: 'number',
		label: 'VLAN',
		id: 'vlan',
		default: 1,
		min: MIN_VLAN_ID,
		max: MAX_VLAN_ID,
	}
}

/** Text entry for one or more ports, e.g. `7`, `2-7`, `12-27, 31-33` or `all` */
export function portsField(): CompanionInputFieldTextInput {
	return {
		type: 'textinput',
		label: 'Ports',
		id: 'ports',
		default: '1',
		tooltip: 'A port (7), a range (2-7), several of either (12-27, 31-33), or all',
	}
}
