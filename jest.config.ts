import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.jest.json',
    }],
  },
  moduleNameMapper: {
    // `server-only` throws when loaded outside a React Server Component.
    // Route handlers pull it in transitively via Clerk/Supabase, so stub it.
    '^server-only$': '<rootDir>/__mocks__/server-only.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
  ],
};

export default config;
