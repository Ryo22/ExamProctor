import { defineConfig } from 'vite'
import obfuscatorPlugin from 'rollup-plugin-obfuscator'

export default defineConfig(({ mode }) => ({
  build: {
    rollupOptions: {
      input: {
        client: 'client.html',
        admin:  'admin.html',
      },
      plugins: mode === 'production' ? [
        obfuscatorPlugin({
          global: false,
          options: {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.5,
            stringArray: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayCallsTransform: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75,
            splitStrings: true,
            splitStringsChunkLength: 10,
          },
        }),
      ] : [],
    },
  },
}))
