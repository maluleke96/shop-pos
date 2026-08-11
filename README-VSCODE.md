# Shop POS — Open in Visual Studio Code

## Quick start

1. Unzip this folder anywhere (e.g. Desktop\shop-pos)
2. Open **Visual Studio Code**
3. File → **Open Folder** → select the `shop-pos` folder
4. Open the terminal in VS Code (`Ctrl + ~`) and run:

```
npm install
npm start
```

Or double-click **START.bat** on Windows.

## Project structure

```
shop-pos/
├── electron/          Main process (database, IPC, business logic)
│   ├── main.js
│   ├── preload.js
│   ├── database/      SQLite schema + migrations
│   └── services/      store.js, export.js
├── src/               Frontend UI
│   ├── index.html
│   ├── css/
│   └── js/
├── scripts/           Build helpers
├── package.json
└── START.bat          Quick launcher
```

## Build installers (optional)

```
npm run build:release
```

Output goes to `dist/` folder.

## Requirements

- Node.js 18+ (https://nodejs.org)
- Visual Studio Code (https://code.visualstudio.com)

## Default login

Use the account created during first-time setup in the app.
