/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        'surface-3': v('surface-3'),
        line: v('line'),
        ink: v('ink'),
        'ink-2': v('ink-2'),
        muted: v('muted'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
        info: v('info'),
        demo: v('demo'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      fontSize: { '2xs': ['0.6875rem', '1rem'] },
      boxShadow: {
        card: '0 1px 0 0 rgb(var(--line) / 0.6), 0 8px 24px -16px rgb(0 0 0 / 0.35)',
        pop: '0 20px 50px -20px rgb(0 0 0 / 0.55)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { 'fade-in': 'fade-in 220ms ease-out both', shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
};
