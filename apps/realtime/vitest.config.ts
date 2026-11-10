import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Some CI sandboxes route all HTTP through a proxy; loopback must bypass it.
    env: { NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    testTimeout: 15000,
  },
});
