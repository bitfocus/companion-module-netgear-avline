import { describe, expect, it } from 'vitest'
import { temperatureSensors, type DeviceInfo } from '../src/types.js'

const device = (sensors: DeviceInfo['temperatureSensors']): DeviceInfo =>
	({ temperatureSensors: sensors }) as DeviceInfo

describe('firmware response shape compatibility', () => {
	it('accepts a single temperature sensor object', () => {
		expect(temperatureSensors(device({ sensorNum: 1, sensorTemp: 42 }))).toEqual([{ sensorNum: 1, sensorTemp: 42 }])
	})

	it('accepts an array and ignores malformed sensor entries', () => {
		expect(
			temperatureSensors(device([{ sensorNum: 2, sensorTemp: 38 }, { sensorNum: 'bad', sensorTemp: 0 } as never])),
		).toEqual([{ sensorNum: 2, sensorTemp: 38 }])
	})
})
