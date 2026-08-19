/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#1B2430',
        surface: '#F7F5F0',
        card: '#FFFFFF',
        primary: {
          DEFAULT: '#2E7D6B', // deep chalkboard teal — anchors the "classroom" identity
          light: '#3F9C86',
          dark: '#1F5A4C',
        },
        accent: '#E0A548', // chalk-gold — for highlights, streaks, positive behavior
        danger: '#C1553D',
        line: '#E4E1D8',
      },
      fontFamily: {
        display: ['"Cairo"', '"IBM Plex Sans Arabic"', 'sans-serif'],
        body: ['"Tajawal"', '"IBM Plex Sans Arabic"', 'sans-serif'],
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
