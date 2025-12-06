/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './layouts/**/*.html',
    './content/**/*.md',
    './static/js/**/*.js',
    './src/**/*.ts',
  ],
  safelist: [
    {
      pattern: /^dark:/,
    },
  ],
  theme: {
    extend: {
      typography: {
        DEFAULT: {
          css: {
            p: {
              marginBottom: '0.5em',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
