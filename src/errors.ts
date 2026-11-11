export function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** How far `connect` got: logging in, or reading the initial data once logged in */
export type ConnectStage = 'login' | 'data'

/**
 * A connect failure after a successful login isn't a login problem, and saying so sends people
 * off checking credentials that work.
 */
export function describeConnectFailure(stage: ConnectStage, error: unknown): { log: string; status: string } {
	return stage === 'login'
		? { log: `Login failed: ${describeError(error)}`, status: 'Unable to log in' }
		: { log: `Data read failed: ${describeError(error)}`, status: 'Unable to read switch data' }
}
