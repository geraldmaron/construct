/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // We'll use black and white as primaries, with gray for nuances
        'black': '#000',
        'white': '#fff',
        'gray': {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
          950: '#030712',
        }
      },
      // We can define gradient colors here if needed, but we'll use the black and white with gray for gradients
      backgroundImage: {
        'gradient-black-white': 'linear-gradient(to right, #000, #fff)',
        'gradient-white-black': 'linear-gradient(to right, #fff, #000)',
        'gradient-gray': 'linear-gradient(to right, #6b7280, #374151)',
      },
    },
  },
  plugins: [],
}
