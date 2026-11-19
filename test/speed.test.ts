import { describe, expect, it } from 'vitest'
import { detectSpeedTable, guessSpeedTable, speedLabel } from '../src/speed.js'

describe('detectSpeedTable', () => {
	it('identifies legacy firmware from codes above 127', () => {
		expect(detectSpeedTable([7, 7, 130])).toBe('legacy')
		expect(detectSpeedTable([128])).toBe('legacy')
		expect(detectSpeedTable([129])).toBe('legacy')
	})

	it('identifies current firmware from codes 16-20', () => {
		expect(detectSpeedTable([7, 10, 20])).toBe('current')
		expect(detectSpeedTable([19])).toBe('current')
		expect(detectSpeedTable([16])).toBe('current')
	})

	it('cannot tell when every code is shared by both tables', () => {
		expect(detectSpeedTable([1, 7, 8, 10, 15])).toBeNull()
		expect(detectSpeedTable([])).toBeNull()
	})
})

describe('guessSpeedTable', () => {
	it('uses the model for the M4300 and M4350', () => {
		expect(guessSpeedTable({ model: 'M4300-28G-PoE+', swVer: '12.0.19.10' })).toBe('legacy')
		expect(guessSpeedTable({ model: 'M4350-24X4V', swVer: '14.0.2.12' })).toBe('current')
	})

	it('uses the firmware version for the M4250', () => {
		expect(guessSpeedTable({ model: 'M4250-26G4F-PoE+', swVer: '13.0.5.14' })).toBe('legacy')
		expect(guessSpeedTable({ model: 'M4250-26G4F-PoE+', swVer: '13.0.4.20' })).toBe('legacy')
		expect(guessSpeedTable({ model: 'M4250-26G4F-PoE+', swVer: '13.0.5.15' })).toBe('current')
		expect(guessSpeedTable({ model: 'm4250-10G2F-PoE+', swVer: 'V14.0.1' })).toBe('current')
	})

	it('makes no guess for an unknown model or unreadable version', () => {
		expect(guessSpeedTable({ model: 'M4500-48XF8C', swVer: '7.0.0' })).toBeNull()
		expect(guessSpeedTable({ model: 'M4250-26G4F-PoE+', swVer: undefined })).toBeNull()
		expect(guessSpeedTable(undefined)).toBeNull()
	})
})

describe('speedLabel', () => {
	it('reads codes with the table for the firmware', () => {
		expect(speedLabel(10, 'legacy')).toBe('40G')
		expect(speedLabel(10, 'current')).toBe('10G')
		expect(speedLabel(128, 'legacy')).toBe('2.5G')
		expect(speedLabel(8, 'current')).toBe('2.5G')
		expect(speedLabel(130, 'legacy')).toBe('Unknown')
		expect(speedLabel(20, 'current')).toBe('Unknown')
	})

	it('falls back to the legacy table when the firmware is not known', () => {
		expect(speedLabel(7, null)).toBe('1000')
		expect(speedLabel(10, null)).toBe('40G')
	})

	it('labels an unrecognised code as unknown', () => {
		expect(speedLabel(99, 'current')).toBe('Unknown')
		expect(speedLabel(128, 'current')).toBe('Unknown')
	})
})
