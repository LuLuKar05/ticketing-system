/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
    // Integration suites rebuild the whole schema (dropSchema + synchronize) against real Postgres
    // in beforeEach — on a cold/loaded box that can exceed Jest's default 5s hook timeout. Give the
    // DB-backed setup ample headroom so a slow schema rebuild isn't a spurious failure.
    testTimeout: 30000,
    // Create the ticketing_test DB + uuid-ossp extension once before the suite.
    globalSetup: '<rootDir>/tests/helpers/globalSetup.ts',
    // reflect-metadata must load before any decorated class is imported.
    setupFiles: ['reflect-metadata'],
    testMatch: ['**/*.test.ts'],
    // ts-jest uses `tsc`, which emits decorator metadata (emitDecoratorMetadata) that
    // TypeORM + tsyringe need — this is why we can't use the esbuild-based runners.
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
    },
};
