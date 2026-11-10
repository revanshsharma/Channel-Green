import { defineConfig, globalIgnores } from 'eslint/config';
import next from 'eslint-config-next';

export default defineConfig([
  ...next,
  globalIgnores(['.next/**', 'next-env.d.ts']),
  {
    rules: {
      // Pixel art goes through canvas, not <img>.
      '@next/next/no-img-element': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
    },
  },
]);
