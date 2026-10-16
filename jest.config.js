module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: [
    // FIXME: I did not manage to get Dexie working in an actual Electron test environment. Testing in JavaScript is
    // cursed, so indexeddb is replaced by an in-memory implementation.
    'fake-indexeddb/auto',
    // Crypto module is not stable in the node version we use, nor can we use the browser.
    '<rootDir>/tests/setup/jest.crypto.js',
  ],
  // The same absolute imports as the webpack build
  moduleNameMapper: {
    // Stylesheets that components import: first, before their path is mapped below
    '\\.s?css$': '<rootDir>/tests/setup/style.js',
    '^(common|src|widgets|resources)/(.*)$': '<rootDir>/$1/$2',
  },
};
