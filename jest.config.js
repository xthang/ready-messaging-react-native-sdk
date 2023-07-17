// const { pathsToModuleNameMapper } = require('ts-jest')
// const { compilerOptions } = require('./tsconfig.json')

module.exports = {
  preset: 'react-native', // ts-jest
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/example/node_modules', '<rootDir>/lib/'],
  // modulePaths: ['<rootDir>'],
  moduleDirectories: ['node_modules', 'src'],
  // moduleNameMapper: { ...pathsToModuleNameMapper(compilerOptions.paths) },
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(react-native|@react-native|react-native-flipper|react-native-randombytes|rn-secure-storage|@readyio)/)',
    '\\.pnp\\.[^\\/]+$',
  ],
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.jest.json',
      isolatedModules: true,
    },
  },
  testRegex: '.*\\.test\\.(ts|tsx)$',
}
