import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		coverage: {
			provider: 'v8',
			include: ['src/fiber.ts', 'src/ports.ts', 'src/types.ts'],
			reporter: ['text', 'html', 'lcov'],
			thresholds: {
				lines: 90,
				functions: 90,
				statements: 90,
				branches: 80,
			},
		},
	},
})
