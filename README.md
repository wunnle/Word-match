# German Matcher (Vite + React)

A small matching game to practice German ↔ English vocabulary.

## Quick start

```bash
pnpm i   # or: npm i  OR  yarn
pnpm dev # or: npm run dev / yarn dev
```

Open the URL printed in the terminal (usually http://localhost:5173).

## Project structure

```
.
├── index.html            # includes Tailwind via CDN for convenience
├── package.json
├── vite.config.js
└── src
    ├── main.jsx
    └── App.jsx           # your game logic
```

> Note: Tailwind is loaded via CDN for speed. If you prefer a proper Tailwind build setup, I can add PostCSS + tailwind.config later.
