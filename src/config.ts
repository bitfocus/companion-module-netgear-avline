import { Regex, type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	host: string
	user: string
}

export interface ModuleSecrets {
	password: string
}

/** The shape of the config before the password was moved into the secrets store */
export interface LegacyModuleConfig extends ModuleConfig {
	password?: string
}

export function getConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'textinput',
			id: 'host',
			label: 'Switch IP',
			width: 4,
			regex: Regex.IP,
		},
		{
			type: 'textinput',
			id: 'user',
			label: 'Username',
			width: 4,
		},
		{
			type: 'secret-text',
			id: 'password',
			label: 'Password',
			width: 4,
		},
	]
}
