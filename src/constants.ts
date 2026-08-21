export const poeStatusLevels: Record<number, string> = {
	'-1': 'Invalid',
	0: 'Disabled',
	1: 'Searching',
	2: 'Delivering Power',
	3: 'Test',
	4: 'Fault',
	5: 'Other Fault',
	6: 'Requesting Power',
	7: 'Overload',
}

export const speedStatusLevels: Record<number, string> = {
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

export const temperatureSensorStates: Record<number, string> = {
	0: 'None',
	1: 'Normal',
	2: 'Warning',
	3: 'Critical',
	4: 'Shutdown',
	5: 'Not Present',
	6: 'Not Operational',
}
