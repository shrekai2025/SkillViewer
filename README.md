# SkillViewer

[中文指南 (Chinese Guide)](README.zh-CN.md)

SkillViewer is a local-first macOS agent skill browser and management tool. It aggregates files from `~/.agents`, `~/.claude`, `~/.codex`, `~/.openclaw`, and any custom folder seamlessly into an immersive desktop app, giving you a smooth experience in finding, viewing, editing, and toggling your daily local LLM agent skills.

## Architecture & Tech Stack

- **Framework**: `Electron + React + TypeScript + Vite`
  Provides stable local filesystem access and deep macOS integration (Finder, Dock) while keeping an extremely modern, fast development loop.
- **Process Model**: `Electron Main + Preload + Renderer`
  Robust IPC pipeline where all heavy file system checks (scanning frontmatters, saving Markdown, managing system disable status) reside securely in the main process.
- **Data Persistence**: `JSON + LocalStorage`
  Theme, UI layout states, and customized directories persist flawlessly via Chromium LocalStorage and JSON userdata. 

## Key Features

- **Automated Discovery**: 
  Instantly scans standard system skill registries like `~/.agents` alongside custom folders without needing manual config. Custom folders can be managed securely within the App.
- **Non-Destructive Toggles**: 
  We manage skill enabled/disabled states intuitively without changing contents. Disabled skills correctly persist across the system using a `.disabled` suffix or within disabled registry directories, achieving true state retention outside of just the UI.
- **Marketplace & Registry**:
  Discover and install new skills directly from external or local registries with true one-click installation and management.
- **Immersive Split-Screen Editor**:
  Say goodbye to crowded views. Double-click any skill to focus. Toggle a real-time Markdown preview via the customizable font-size pane, letting you craft prompts distraction-free inside the context split window.
- **Theme Support**:
  Silky-smooth light and dark modes syncing with your macOS appearance globally.

## Installation & macOS Security

Currently, the compiled SkillViewer app is **unsigned**. When you first open the downloaded `.dmg` or `.app`, macOS Gatekeeper will block it with an "App is damaged" or "Cannot be opened because the developer cannot be verified" warning.

To bypass this and run the app safely, run the following command in your Terminal after dragging the app to your `Applications` folder:

```bash
sudo xattr -rd com.apple.quarantine /Applications/Skillviewer.app
```

Alternatively, you are fully encouraged to build the app from source!

## Development Setup

```bash
# Install dependencies
npm install

# Start development server with hot-reload
npm run dev

# Build the desktop packages
npm run build
npm run dist:mac
```

Enjoy finding and refining your skills!
