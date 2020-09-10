import resolve from 'rollup-plugin-node-resolve';

export default {
  input: 'src/main.js',
  output: {
    file: 'dist/long-term-card-bundle.js',
    format: 'umd',
    name: 'MiniGraphCard',
  },
  plugins: [
    resolve(),
  ],
};
