module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^obsidian$': '<rootDir>/src/__mocks__/obsidian.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {}],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/__mocks__/**',
    '!src/models.ts',
    '!src/views/**',
    '!src/commands/**',
  ],
  coverageThreshold: {
    global: {
      lines: 60,
      functions: 60,
    },
  },
};
