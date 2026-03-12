import { defineConfig } from 'tsup'

export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    main: 'src-electron/main.ts',
    preload: 'src-electron/preload.ts',
  },
  external: ['electron'],
  format: ['cjs'],
  outDir: 'dist-electron',
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node22',
})
