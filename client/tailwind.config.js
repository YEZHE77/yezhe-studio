/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f1115',
        panel: '#171a21',
        panel2: '#1f242e',
        line: '#2a2f3a',
        muted: '#8b93a7',
        brand: '#ff5a7a',
        brand2: '#7c5cff'
      },
      borderRadius: { xl2: '16px' }
    }
  },
  plugins: []
};
