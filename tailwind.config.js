export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 20px 40px rgba(15, 23, 42, 0.08)"
      },
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          500: "#4338ca"
        }
      }
    }
  },
  plugins: []
}
