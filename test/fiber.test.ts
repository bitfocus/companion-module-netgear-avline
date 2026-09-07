import { describe, expect, it } from 'vitest'
import { fiberVariableId, fibreModules, normaliseFiberOptic } from '../src/fiber.js'

describe('fiber optics compatibility', () => {
	it('normalises an M4350 active optic to a physical-port variable id', () => {
		const optic = normaliseFiberOptic({
			portName: '1/0/20',
			port: 20,
			temperature: '57.6',
			voltage: '3.381',
			partNumber: 'ACM762',
		})

		expect(optic).toMatchObject({ port: '20', portName: '1/0/20', temp: '57.6', voltage: '3.381' })
		expect(fiberVariableId(optic!.port)).toBe('20')
	})

	it('normalises an M4250 optic and numeric diagnostics', () => {
		expect(normaliseFiberOptic({ portName: '0/11', port: 11, temperature: 51.5 })).toMatchObject({
			port: '11',
			temp: '51.5',
		})
	})

	it('falls back to the final portName segment when port is missing', () => {
		expect(normaliseFiberOptic({ portName: '1/0/28', temperature: '29.1' })).toMatchObject({
			port: '28',
			temp: '29.1',
		})
	})

	it('keeps legacy field names and passive DAC blank diagnostics', () => {
		expect(normaliseFiberOptic({ port: '1/0/14', temp: '', compliance: 'Passive cable' })).toMatchObject({
			port: '1/0/14',
			temp: '',
		})
	})

	it('rejects entries with no usable port and sanitises legacy interface names', () => {
		expect(normaliseFiberOptic({ temperature: '20' })).toBeNull()
		expect(fiberVariableId('1/0/49')).toBe('1_0_49')
		expect(fibreModules([{ port: '20' }, { port: '' }])).toEqual([{ port: '20' }])
	})
})
