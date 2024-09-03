module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    transform_regex: ['ts-jest', {
      '^.+\\.ts$': 'ts-jest',
      tsconfig: 'tsconfig.json',
    }],
  },
  testMatch: ['**/src/**/*.test.ts'],
};