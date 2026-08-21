import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { LegacyModuleConfig, ModuleConfig, ModuleSecrets } from './config.js'

type UpgradeScript = CompanionStaticUpgradeScript<ModuleConfig, ModuleSecrets>

const convertPoeEnabledToString: UpgradeScript = (_context, props) => {
	const changedActions = []

	for (const action of props.actions) {
		if (action.actionId !== 'setPoeEnabled') continue
		if (typeof action.options.enabled !== 'boolean') continue

		action.options.enabled = action.options.enabled ? 'true' : 'false'
		changedActions.push(action)
	}

	return { updatedConfig: null, updatedActions: changedActions, updatedFeedbacks: [] }
}

const movePasswordToSecrets: UpgradeScript = (_context, props) => {
	const config: LegacyModuleConfig | null = props.config
	if (!config || typeof config.password !== 'string') {
		return { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
	}

	const password = config.password
	delete config.password

	return {
		updatedConfig: config,
		updatedSecrets: { ...props.secrets, password },
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

const pinExistingRebootSaveOption: UpgradeScript = (_context, props) => {
	const changedActions = []

	for (const action of props.actions) {
		if (action.actionId !== 'reboot') continue
		if (action.options.save !== undefined) continue

		action.options.save = false
		changedActions.push(action)
	}

	return { updatedConfig: null, updatedActions: changedActions, updatedFeedbacks: [] }
}

const convertPoePortToPortSpec: UpgradeScript = (_context, props) => {
	const changedActions = []

	for (const action of props.actions) {
		if (action.actionId !== 'setPoeEnabled' && action.actionId !== 'powerCyclePoe') continue
		if (action.options.port === undefined) continue

		action.options.ports = String(action.options.port)
		delete action.options.port
		changedActions.push(action)
	}

	return { updatedConfig: null, updatedActions: changedActions, updatedFeedbacks: [] }
}

export const upgradeScripts: UpgradeScript[] = [
	convertPoeEnabledToString,
	movePasswordToSecrets,
	pinExistingRebootSaveOption,
	convertPoePortToPortSpec,
]
