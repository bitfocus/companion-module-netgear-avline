import type { DeviceInfo } from './types.js'

/**
 * Which numbering the firmware uses for port speed codes. Older firmware (M4300, M4250 up to
 * 13.0.5.14) puts some speeds above 127; newer firmware (M4350, later M4250) renumbers them 1-20.
 */
export type SpeedTable = 'legacy' | 'current'

/*
 * Labels for the same speed are kept identical across both tables, so a `port_X_speed` value
 * used in an expression or trigger doesn't change when a switch is upgraded.
 */
const legacySpeedLabels: Record<number, string> = {
	1: 'Auto',
	2: '100',
	3: '100',
	4: '10',
	5: '10',
	6: '100',
	7: '1000',
	8: '10G',
	9: '20G',
	10: '40G',
	11: '25G',
	12: '50G',
	13: '100G',
	14: 'AAL5_155',
	15: '5G',
	128: '2.5G',
	129: 'LAG',
	130: 'Unknown',
}

const currentSpeedLabels: Record<number, string> = {
	1: 'Auto',
	2: '100',
	3: '100',
	4: '10',
	5: '10',
	6: '100',
	7: '1000',
	8: '2.5G',
	9: '5G',
	10: '10G',
	11: '20G',
	12: '25G',
	13: '40G',
	14: '50G',
	15: '100G',
	16: 'AAL5_155',
	17: '200G',
	18: '400G',
	19: 'LAG',
	20: 'Unknown',
}

/** The last M4250 firmware known to use the legacy codes */
const LAST_LEGACY_M4250_FIRMWARE = [13, 0, 5, 14]

/**
 * Identify the table from codes that only one of them uses. A port with no link reports 130 on
 * legacy firmware and 20 on current firmware, so most switches give themselves away on the first
 * poll. Returns `null` when every code is one both tables share.
 */
export function detectSpeedTable(codes: number[]): SpeedTable | null {
	if (codes.some((code) => code >= 128)) return 'legacy'
	if (codes.some((code) => code >= 16 && code <= 20)) return 'current'
	return null
}

/** Guess the table from the model and firmware version, for when the codes don't settle it */
export function guessSpeedTable(device: Pick<DeviceInfo, 'model' | 'swVer'> | undefined): SpeedTable | null {
	const model = device?.model?.toUpperCase() ?? ''

	if (model.includes('M4350')) return 'current'
	if (model.includes('M4300')) return 'legacy'
	if (model.includes('M4250')) {
		const version = parseVersion(device?.swVer)
		if (!version) return null
		return compareVersions(version, LAST_LEGACY_M4250_FIRMWARE) > 0 ? 'current' : 'legacy'
	}

	return null
}

/** With no table known, codes 1-7 are the same in both and the rest fall back to the legacy table */
export function speedLabel(code: number, table: SpeedTable | null): string {
	const labels = table === 'current' ? currentSpeedLabels : legacySpeedLabels
	return labels[code] ?? 'Unknown'
}

function parseVersion(version: string | undefined): number[] | null {
	const match = version?.match(/\d+(?:\.\d+)*/)
	return match ? match[0].split('.').map(Number) : null
}

function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0)
		if (difference !== 0) return difference
	}
	return 0
}
