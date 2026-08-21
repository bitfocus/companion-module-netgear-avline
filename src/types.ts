/*
 * Shapes of the JSON payloads returned by the switch's REST API.
 *
 * Modelled on the M4300 ConfigAgent OpenAPI spec (2.0.0.59) in `docs/`. That spec covers a
 * different model in the same family, so fields the M4250 is known to spell differently are
 * described as tolerantly as possible. Only the parts the module uses are described here.
 */

export interface ApiResponseEnvelope {
	resp: {
		/** `success`, `failure` or `fail` */
		status: string
		respCode?: number
		respMsg?: string
	}
}

export interface LoginResponse extends ApiResponseEnvelope {
	login: {
		token: string
		/** Seconds until the token expires */
		expires?: number | string
	}
}

export interface PoePortConfig {
	portid: number
	enable: boolean
	/** See `poeStatusLevels` */
	status: number
	/** Current draw, in milliwatts */
	currentPower: number
	powerLimitMode: number
	classification: number
	/** Power limit, in milliwatts */
	powerLimit: number
	[key: string]: unknown
}

export interface PoeConfigResponse extends ApiResponseEnvelope {
	poePortConfig: PoePortConfig[]
}

/** Switch-wide PoE state, from `/poe_config` */
export interface PoeConfig {
	/** `ON` or `OFF` */
	pseMainOperationStatus?: string
	totalPowerConsumedWatts?: string
	/** `Dynamic` or `Static` */
	powerManagmentMode?: string
	firmwareVersion?: string
	[key: string]: unknown
}

export interface PoeConfigGetResponse extends ApiResponseEnvelope {
	poe_config: PoeConfig
}

export interface SwitchStatsPort {
	portId: number
	/** See `speedStatusLevels` */
	speed: number
	/** `0` = link up, `1` = link down */
	status: number
	vlans: number[]
	[key: string]: unknown
}

export interface PortStatsResponse extends ApiResponseEnvelope {
	switchStatsPort: SwitchStatsPort[]
}

export interface TemperatureSensor {
	sensorNum: number
	sensorDesc?: string
	sensorTemp: number
	/** See `temperatureSensorStates` */
	sensorState?: number
}

export interface DeviceInfo {
	numOfActivePorts: number
	cpuUsage: string
	memoryUsage: string
	upTime: string
	name?: string
	model?: string
	serialNumber?: string
	swVer?: string
	numOfPorts?: number
	lastReboot?: string
	poeState?: boolean
	/** The switch's PoE budget, in milliwatts */
	adminPoePower?: number
	rxData?: number
	txData?: number
	/** Documented as an array of objects, but some firmware sends a bare string */
	fanState?: unknown
	/** Documented as an array, but some firmware sends a single object */
	temperatureSensors?: TemperatureSensor[] | TemperatureSensor
	[key: string]: unknown
}

export interface DeviceInfoResponse extends ApiResponseEnvelope {
	deviceInfo: DeviceInfo
}

export interface DeviceNameResponse extends ApiResponseEnvelope {
	deviceName: {
		name: string
	}
}

/** The spec documents an array, but firmware has been seen to send a single sensor object */
export function temperatureSensors(device: DeviceInfo): TemperatureSensor[] {
	const sensors = device.temperatureSensors
	if (!sensors) return []

	return (Array.isArray(sensors) ? sensors : [sensors]).filter((sensor) => typeof sensor?.sensorNum === 'number')
}
