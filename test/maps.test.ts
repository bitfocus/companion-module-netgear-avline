import { describe, expect, it } from 'vitest'
import { PortConfigurationMap, PortPoeConfigurationMap } from '../src/switch.js'

describe('switch configuration maps', () => {
	it('rejects a PoE action for a missing or non-PoE port', () => {
		const ports = new PortPoeConfigurationMap([])
		expect(() => ports.require_port_configuration(12)).toThrow('Port 12 does not support POE')
	})

	it('replaces refreshed port configuration without duplicating it', () => {
		const ports = new PortConfigurationMap([{ ID: 1, adminMode: true }])
		ports.replace({ ID: 1, adminMode: false })
		ports.replace({ ID: 2, adminMode: true, isPoE: true })

		expect(ports.all()).toEqual([
			{ ID: 1, adminMode: false },
			{ ID: 2, adminMode: true, isPoE: true },
		])
		expect(ports.poe_ports()).toEqual([{ ID: 2, adminMode: true, isPoE: true }])
	})
})
