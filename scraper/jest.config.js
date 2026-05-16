/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['./jest.setup.ts'],
  globalTeardown: './jest.teardown.ts',
  testTimeout: 2592000000, // 30 days in milliseconds (30 * 24 * 60 * 60 * 1000)
};
