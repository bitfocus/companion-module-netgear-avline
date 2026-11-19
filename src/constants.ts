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

export const temperatureSensorStates: Record<number, string> = {
	0: 'None',
	1: 'Normal',
	2: 'Warning',
	3: 'Critical',
	4: 'Shutdown',
	5: 'Not Present',
	6: 'Not Operational',
}
