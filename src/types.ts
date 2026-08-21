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

/** A unicast/multicast/broadcast rate limit, part of a port's configuration */
export interface PortRateLimit {
	status: boolean
	threshold: number
}

/** Per-port configuration, from `/swcfg_port` */
export interface PortConfig {
	ID: number
	description?: string
	/** Whether the physical interface is enabled */
	adminMode?: boolean
	/** Whether the port is PoE capable */
	isPoE?: boolean
	portVlanId?: number
	portType?: number
	txRate?: number
	defVlanPrio?: number
	rtlimitUcast?: PortRateLimit
	rtlimitMcast?: PortRateLimit
	rtlimitBcast?: PortRateLimit
	[key: string]: unknown
}

export interface PortConfigResponse extends ApiResponseEnvelope {
	/** An array when every port is requested at once, a single port otherwise */
	switchPortConfig: PortConfig[] | PortConfig
}

export interface SwitchStatsPort {
	portId: number
	/** See `speedStatusLevels` */
	speed: number
	/** `0` = link up, `1` = link down */
	status: number
	vlans: number[]
	/** Current receive bit rate, in Mbps */
	rxMbps?: string
	/** Current transmit bit rate, in Mbps */
	txMbps?: string
	/** Total bytes received */
	trafficRx?: number
	/** Total bytes transmitted */
	trafficTx?: number
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

/** A port's VLAN switchport configuration, from `/dot1q_sw_port_config` */
export interface Dot1qPortConfig {
	interface?: number
	accessVlan?: number
	allowedVlanList?: string[]
	/** `none`, `general`, `access`, `trunk`, `privateHost` or `privatePromisc` */
	configMode?: string
	nativeVlan?: number | string
	[key: string]: unknown
}

export interface Dot1qPortConfigResponse extends ApiResponseEnvelope {
	dot1q_sw_port_config: Dot1qPortConfig
}

/** SFP diagnostics, from `/fiber_optics` */
export interface FiberOptic {
	port: string
	temp?: string
	voltage?: string
	current?: string
	outputPower?: string
	inputPower?: string
	txFault?: string
	los?: string
	faultStatus?: string
	vendorName?: string
	serialNumber?: string
	partNumber?: string
	[key: string]: unknown
}

export interface FiberOpticsResponse extends ApiResponseEnvelope {
	/** An array in practice, though the spec describes a single module */
	fiber_optics: FiberOptic[] | FiberOptic
}

/** An LLDP neighbour, from `/lldp_remote_devices` */
export interface LldpRemoteDevice {
	id?: number
	/** Interface the neighbour was seen on. Matches the port number for physical ports */
	ifIndex: number
	chassisId?: string
	remotePortId?: string
	remotePortDesc?: string
	remoteSysName?: string
	remoteSysDesc?: string
	[key: string]: unknown
}

export interface LldpRemoteDevicesResponse extends ApiResponseEnvelope {
	lldp_remote_devices: LldpRemoteDevice[]
}

/** A port's membership of a VLAN */
export interface VlanPortMember {
	port: number
	/** Whether the port carries the VLAN tagged */
	tagged: boolean
}

/** A VLAN's full membership, from `/swcfg_vlan_membership` */
export interface VlanMembership {
	vlanid: number
	portMembers?: VlanPortMember[]
	[key: string]: unknown
}

export interface VlanMembershipResponse extends ApiResponseEnvelope {
	vlanMembership: VlanMembership
}
