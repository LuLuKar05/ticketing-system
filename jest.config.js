/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    testEnvironment: 'node',
    roots: ['<rootDir>/tests'],
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
