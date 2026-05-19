# Native App Packaging Guide — CHRONICLE

Professional Narrative System — Desktop Distribution
Date: June 2025
Status: Planning / Reference Document

---

## Overview

This guide documents how to package Chronicle as a native desktop application for macOS (.dmg/.app) and Windows (.exe installer). Chronicle is a two-process application — a Python/FastAPI backend and a React/Vite frontend — so the core challenge is bundling a Python runtime alongside a native desktop shell.

### Current Architecture

| Component | Stack | Port |
|-----------|-------|------|
| Backend | Python 3.12, FastAPI, uvicorn, SQLite | 8180 |
| Frontend | React 19, TypeScript, Vite | 5180 (dev) |
| Database | SQLite (WAL mode), file-based | `data/chronicle.db` |
| Attachments | Local filesystem | `data/attachments/` |

### Key Environment Variables

```
CHRONICLE_PORT=8180
CHRONICLE_HOST=0.0.0.0
CHRONICLE_FRONTEND_URL=http://localhost:5180
CHRONICLE_DB_PATH=data/chronicle.db
CHRONICLE_ATTACHMENTS=data/attachments
```

---

## Framework Evaluation: Tauri vs Electron

### Recommendation: Tauri

| Criteria | Tauri | Electron |
|----------|-------|----------|
| Bundle size | ~5–10 MB (uses OS webview) | ~150–300 MB (ships Chromium) |
| Memory usage | Lower (native webview) | Higher (full Chromium process) |
| Backend language | Rust (with sidecar support for any binary) | Node.js (with child_process for Python) |
| Frontend compatibility | Any web framework — Vite + React works natively | Any web framework |
| Sidecar support | First-class `tauri::api::process::sidecar` | Manual via `child_process.spawn()` |
| Auto-update | Built-in updater plugin | electron-updater (mature) |
| Code signing | Supported (macOS notarization + Windows Authenticode) | Supported |
| Maturity | Tauri v2 stable (2024) | Very mature (10+ years) |
| Python bundling | Sidecar binary (PyInstaller output) | python-shell or child_process |

**Why Tauri wins for Chronicle:**

1. Chronicle already uses Vite + React — Tauri integrates with Vite out of the box via `@tauri-apps/cli`.
2. Tauri's sidecar feature is purpose-built for bundling external binaries (like a PyInstaller-packaged FastAPI server).
3. The resulting app is 10–20x smaller than an Electron equivalent.
4. Tauri v2 provides a stable plugin ecosystem for auto-updates, system tray, file dialogs, and notifications.
5. The Rust backend layer can handle health checks, process lifecycle, and graceful shutdown without additional dependencies.

---

## Architecture: Packaged App

```
┌─────────────────────────────────────────────────────┐
│                  Tauri Native Shell                  │
│              (Rust + OS WebView)                     │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │         React Frontend (Vite build)            │  │
│  │         Loaded from local dist/ files          │  │
│  │         API calls → http://127.0.0.1:8180      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │         Tauri Rust Backend                     │  │
│  │         • Spawns Python sidecar on launch      │  │
│  │         • Health-checks /api/health            │  │
│  │         • Manages graceful shutdown            │  │
│  └──────────────────┬─────────────────────────────┘  │
│                     │                                │
│  ┌──────────────────▼─────────────────────────────┐  │
│  │    Python Sidecar (PyInstaller binary)         │  │
│  │    FastAPI + uvicorn on 127.0.0.1:8180         │  │
│  │    SQLite DB in app data directory             │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

Data Storage:
  macOS:   ~/Library/Application Support/Chronicle/
  Windows: %APPDATA%/Chronicle/
  Contents: chronicle.db, attachments/, exports/
```

---

## Step-by-Step Setup

### Prerequisites

- Rust toolchain (rustup): https://rustup.rs
- Node.js 18+ and npm
- Python 3.12+
- PyInstaller: `pip install pyinstaller`
- Tauri CLI: `npm install -D @tauri-apps/cli@latest`

### 1. Bundle the Python Backend with PyInstaller

PyInstaller compiles the FastAPI backend into a single executable (or one-folder bundle) that includes the Python interpreter and all dependencies.

#### Create the PyInstaller spec

From `repository/Chronicle/backend/`:

```bash
# One-folder mode (recommended for debugging; switch to --onefile for release)
pyinstaller \
  --name chronicle-backend \
  --noconfirm \
  --clean \
  --add-data "*.py:." \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --collect-submodules uvicorn \
  --collect-submodules fastapi \
  --collect-submodules pydantic \
  main.py
```

#### Verify the build

```bash
# Test the bundled binary
./dist/chronicle-backend/chronicle-backend --host 127.0.0.1 --port 8180
# Or if using --onefile:
./dist/chronicle-backend --host 127.0.0.1 --port 8180
```

#### PyInstaller entry point wrapper

Create `repository/Chronicle/backend/desktop_entry.py` to handle app-data paths:

```python
"""
Entry point for the PyInstaller-bundled Chronicle backend.
Resolves data directories to the OS-appropriate app data location.
"""
import os
import sys
import platform

def get_app_data_dir() -> str:
    """Return the OS-appropriate app data directory for Chronicle."""
    if platform.system() == "Darwin":
        base = os.path.expanduser("~/Library/Application Support")
    elif platform.system() == "Windows":
        base = os.environ.get("APPDATA", os.path.expanduser("~\\AppData\\Roaming"))
    else:
        base = os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share"))
    
    app_dir = os.path.join(base, "Chronicle")
    os.makedirs(app_dir, exist_ok=True)
    return app_dir

def main():
    app_data = get_app_data_dir()
    
    # Set environment variables for the Chronicle backend
    os.environ.setdefault("CHRONICLE_DB_PATH", os.path.join(app_data, "chronicle.db"))
    os.environ.setdefault("CHRONICLE_ATTACHMENTS", os.path.join(app_data, "attachments"))
    os.environ.setdefault("CHRONICLE_HOST", "127.0.0.1")
    os.environ.setdefault("CHRONICLE_PORT", "8180")
    os.environ.setdefault("CHRONICLE_FRONTEND_URL", "tauri://localhost")
    
    # Ensure subdirectories exist
    os.makedirs(os.path.join(app_data, "attachments"), exist_ok=True)
    os.makedirs(os.path.join(app_data, "exports"), exist_ok=True)
    
    import uvicorn
    uvicorn.run(
        "main:app",
        host=os.environ["CHRONICLE_HOST"],
        port=int(os.environ["CHRONICLE_PORT"]),
        log_level="info",
    )

if __name__ == "__main__":
    main()
```

Then build PyInstaller against this entry point instead:

```bash
pyinstaller \
  --name chronicle-backend \
  --noconfirm \
  --clean \
  --add-data "main.py:." \
  --add-data "database.py:." \
  --add-data "models.py:." \
  --add-data "config.py:." \
  --add-data "export_engine.py:." \
  --add-data "scheduled_engine.py:." \
  --hidden-import uvicorn.logging \
  --hidden-import uvicorn.loops.auto \
  --hidden-import uvicorn.protocols.http.auto \
  --hidden-import uvicorn.protocols.websockets.auto \
  --hidden-import uvicorn.lifespan.on \
  --collect-submodules uvicorn \
  --collect-submodules fastapi \
  --collect-submodules pydantic \
  desktop_entry.py
```

### 2. Initialize Tauri in the Frontend

From `repository/Chronicle/frontend/`:

```bash
# Initialize Tauri (creates src-tauri/ directory)
npm install -D @tauri-apps/cli@latest @tauri-apps/api@latest
npx tauri init
```

When prompted:
- App name: `Chronicle`
- Window title: `CHRONICLE — Professional Narrative System`
- Frontend dev URL: `http://localhost:5180`
- Frontend dist directory: `../dist`
- Frontend dev command: `npm run dev`
- Frontend build command: `npm run build`

### 3. Configure Tauri for the Python Sidecar

#### `src-tauri/tauri.conf.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/nicedoc/tauri/dev/tooling/cli/schema.json",
  "productName": "Chronicle",
  "version": "1.1.0",
  "identifier": "com.chronicle.app",
  "build": {
    "beforeBuildCommand": "npm run build",
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:5180",
    "frontendDist": "../dist"
  },
  "app": {
    "title": "CHRONICLE — Professional Narrative System",
    "windows": [
      {
        "title": "CHRONICLE",
        "width": 1280,
        "height": 860,
        "minWidth": 900,
        "minHeight": 600,
        "resizable": true,
        "fullscreen": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; connect-src 'self' http://127.0.0.1:8180; style-src 'self' 'unsafe-inline'; img-src 'self' data:"
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "externalBin": [
      "binaries/chronicle-backend"
    ],
    "macOS": {
      "minimumSystemVersion": "10.15",
      "signingIdentity": null,
      "entitlements": null
    },
    "windows": {
      "wix": {
        "language": "en-US"
      }
    }
  },
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,
      "endpoints": [
        "https://releases.chronicle-app.example.com/{{target}}/{{arch}}/{{current_version}}"
      ],
      "pubkey": "YOUR_PUBLIC_KEY_HERE"
    }
  }
}
```

#### Place the PyInstaller binary

After building with PyInstaller, copy the output to the Tauri sidecar location:

```bash
# macOS (Apple Silicon)
mkdir -p frontend/src-tauri/binaries
cp backend/dist/chronicle-backend/chronicle-backend \
   frontend/src-tauri/binaries/chronicle-backend-aarch64-apple-darwin

# macOS (Intel)
cp backend/dist/chronicle-backend/chronicle-backend \
   frontend/src-tauri/binaries/chronicle-backend-x86_64-apple-darwin

# Windows
cp backend/dist/chronicle-backend/chronicle-backend.exe \
   frontend/src-tauri/binaries/chronicle-backend-x86_64-pc-windows-msvc.exe
```

Tauri requires platform-specific suffixes on sidecar binaries. The naming convention is:
`{binary-name}-{target-triple}[.exe]`

### 4. Rust Sidecar Management Code

#### `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::sync::Mutex;
use tauri::api::process::{Command, CommandChild};

struct BackendProcess(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle();
            
            // Spawn the Python backend sidecar
            let (mut rx, child) = Command::new_sidecar("chronicle-backend")
                .expect("failed to create sidecar command")
                .spawn()
                .expect("failed to spawn chronicle-backend sidecar");

            // Store the child process handle for cleanup
            let state = app_handle.state::<BackendProcess>();
            *state.0.lock().unwrap() = Some(child);

            // Log sidecar output (optional, useful for debugging)
            tauri::async_runtime::spawn(async move {
                use tauri::api::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            println!("[backend] {}", line);
                        }
                        CommandEvent::Stderr(line) => {
                            eprintln!("[backend] {}", line);
                        }
                        CommandEvent::Error(err) => {
                            eprintln!("[backend error] {}", err);
                        }
                        _ => {}
                    }
                }
            });

            // Wait for backend to be ready before showing the window
            let window = app.get_window("main").unwrap();
            tauri::async_runtime::spawn(async move {
                let client = reqwest::Client::new();
                let mut attempts = 0;
                loop {
                    if let Ok(resp) = client
                        .get("http://127.0.0.1:8180/api/health")
                        .send()
                        .await
                    {
                        if resp.status().is_success() {
                            break;
                        }
                    }
                    attempts += 1;
                    if attempts > 30 {
                        eprintln!("Backend failed to start after 30 attempts");
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
                let _ = window.show();
            });

            Ok(())
        })
        .on_window_event(|event| {
            if let tauri::WindowEvent::Destroyed = event.event() {
                // Gracefully kill the backend when the window closes
                let state = event.window().state::<BackendProcess>();
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Chronicle");
}
```

#### `src-tauri/Cargo.toml` dependencies

```toml
[dependencies]
tauri = { version = "2", features = ["shell-sidecar", "process-command-api"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["time"] }
```

### 5. Frontend Configuration for Packaged Mode

Update `vite.config.ts` to support both dev and packaged modes:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port in dev mode
  server: {
    port: 5180,
    strictPort: true,
  },
  // In production (packaged), the frontend is served as static files.
  // API calls go directly to the backend on 127.0.0.1:8180.
  // No proxy needed — the frontend uses absolute URLs in production.
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
```

The frontend API calls should detect the environment:

```typescript
// src/config.ts (or inline in fetch calls)
const API_BASE = import.meta.env.DEV
  ? '/api'                           // Vite proxy in dev
  : 'http://127.0.0.1:8180/api';    // Direct in packaged app
```

---

## Data Storage Paths

### macOS

```
~/Library/Application Support/Chronicle/
├── chronicle.db          # SQLite database
├── attachments/          # File attachments
└── exports/              # Generated markdown exports
```

### Windows

```
%APPDATA%\Chronicle\
├── chronicle.db
├── attachments\
└── exports\
```

### Linux (if supported in the future)

```
~/.local/share/Chronicle/
├── chronicle.db
├── attachments/
└── exports/
```

The `desktop_entry.py` wrapper (see Step 1) handles path resolution at runtime. The database and attachments are never stored inside the app bundle — they persist across updates and reinstalls.

---

## Building the Installers

### macOS (.dmg / .app)

```bash
cd frontend

# Development build (with dev tools)
npx tauri dev

# Production build — creates .dmg and .app
npx tauri build
```

Output: `src-tauri/target/release/bundle/dmg/Chronicle_1.1.0_aarch64.dmg`

### Windows (.exe / .msi)

```bash
cd frontend

# Production build — creates .exe (NSIS) and .msi (WiX)
npx tauri build
```

Output:
- `src-tauri/target/release/bundle/nsis/Chronicle_1.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Chronicle_1.1.0_x64_en-US.msi`

### Cross-compilation notes

Tauri does not support cross-compilation for the native shell. Build on the target platform:
- macOS builds require a Mac (or macOS CI runner)
- Windows builds require Windows (or Windows CI runner)
- The PyInstaller sidecar binary must also be built on the target platform

---

## Code Signing

### macOS — Notarization

Apple requires all distributed macOS apps to be signed and notarized.

#### Prerequisites

1. Apple Developer account ($99/year)
2. Developer ID Application certificate (from Xcode or Apple Developer portal)
3. App-specific password for notarization (generated at appleid.apple.com)

#### Environment variables for Tauri build

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
export APPLE_ID="your@email.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
```

#### Tauri handles notarization automatically

When `APPLE_SIGNING_IDENTITY` is set, `tauri build` will:
1. Sign the .app bundle with your Developer ID certificate
2. Submit to Apple's notarization service
3. Staple the notarization ticket to the .dmg

#### Entitlements

Create `src-tauri/entitlements.plist` if the app needs specific permissions:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <false/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
```

Note: App Sandbox is disabled (`false`) because Chronicle needs to spawn the Python sidecar process and access the app data directory. If distributing via the Mac App Store, sandboxing is required and the sidecar approach would need adjustment.

### Windows — Authenticode Signing

#### Prerequisites

1. Code signing certificate from a trusted CA (DigiCert, Sectigo, etc.) or an EV certificate for SmartScreen reputation
2. `signtool.exe` (included in Windows SDK)

#### Environment variables for Tauri build

```bash
set TAURI_SIGNING_PRIVATE_KEY=path/to/private-key.pem
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-password
```

#### Manual signing (if not using Tauri's built-in)

```powershell
# Sign the .exe installer
signtool sign /f "certificate.pfx" /p "password" /tr http://timestamp.digicert.com /td sha256 /fd sha256 "Chronicle_1.1.0_x64-setup.exe"

# Verify the signature
signtool verify /pa "Chronicle_1.1.0_x64-setup.exe"
```

#### SmartScreen considerations

- New certificates start with zero reputation — users will see "Windows protected your PC" warnings
- EV (Extended Validation) certificates provide immediate SmartScreen reputation
- Standard certificates build reputation over time as more users install the app
- Signing the installer is strongly recommended even for internal distribution

---

## Update Strategy — Offline First

Chronicle is distributed offline (no update server, no GitHub). Users receive a new installer file directly (USB, email, shared drive) and run it. The app handles the rest.

### How Offline Updates Work

The update path is simple because of two architectural decisions:

1. User data lives in the OS app data directory, not inside the app bundle
2. Schema migrations run automatically on startup and are idempotent

The flow:

```
User receives Chronicle_v1.2_setup.exe (or .dmg)
         │
         ▼
Runs installer
         │
         ├── Fresh install? → Creates new app bundle, first-run welcome screen
         │
         └── Existing install? → Replaces app binary in place (NSIS/WiX handles this)
                  │
                  ▼
         App launches, finds existing chronicle.db in AppData
                  │
                  ▼
         init_db() runs:
           1. Reads schema_version from settings table
           2. If behind → auto-backs up DB to data/backups/
           3. Runs all migrations (idempotent — safe to re-run)
           4. Stamps new schema_version
                  │
                  ▼
         User is in the app with all their data + new features
```

### Infrastructure Already in Place

| Component | Status | Details |
|-----------|--------|---------|
| Schema version tracking | ✅ Done | `schema_version` in settings table, `CURRENT_SCHEMA_VERSION` constant in `database.py` |
| Pre-migration auto-backup | ✅ Done | Copies `chronicle.db` to `data/backups/chronicle_pre_migration_{timestamp}.db` before any migration. Keeps last 5. |
| Idempotent migrations | ✅ Done | All `ALTER TABLE ADD COLUMN` wrapped in try/except. Table rebuilds check before running. |
| Data outside app bundle | ✅ Done | DB, attachments, exports all in `~/Library/Application Support/Chronicle/` (macOS) or `%APPDATA%\Chronicle\` (Windows) |
| App version endpoint | ✅ Done | `GET /api/version` returns `app_version` and `schema_version` |
| Backup envelope with version | ✅ Done | Export JSON includes `chronicle_version`, `schema_version`, `backup_date` |
| Backup validation on export | ✅ Done | Export reads back the file and verifies row counts match |

### What the Installer Does (Tauri NSIS / WiX)

Tauri's NSIS installer (Windows) and DMG (macOS) handle upgrade-in-place natively:

- **Windows (NSIS):** Detects existing installation in the same directory. Overwrites the binary, preserves AppData. No uninstall needed. The user just runs the new `.exe` installer.
- **macOS (DMG):** User drags the new `.app` to Applications, replacing the old one. Data in `~/Library/Application Support/Chronicle/` is untouched.

No custom upgrade logic needed in the installer itself.

### Version Display

The app exposes `GET /api/version` which returns:

```json
{
  "app_version": "1.1.0",
  "schema_version": 2
}
```

The About modal in the frontend should display this so users can confirm they're running the version you gave them.

### Future: Online Auto-Update (When Ready for AWS)

When Chronicle moves to AWS hosting, enable Tauri's built-in updater plugin:

1. Host update manifests on S3/CloudFront
2. Set the endpoint URL in `tauri.conf.json` → `plugins.updater.endpoints`
3. App checks on launch, shows dialog, downloads, restarts

This is a configuration change, not an architecture change. The offline path continues to work alongside it.

---

## Alternative Approach: Electron

If Tauri is not viable (e.g., Rust toolchain unavailable, team preference), Electron is the fallback.

### Key differences

```bash
# Initialize Electron
npm install electron electron-builder --save-dev
```

#### Spawning Python in Electron (`main.js`)

```javascript
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let backendProcess;

function startBackend() {
  const backendPath = path.join(
    process.resourcesPath, 'backend', 'chronicle-backend'
  );
  backendProcess = spawn(backendPath, ['--host', '127.0.0.1', '--port', '8180']);
  
  backendProcess.stdout.on('data', (data) => console.log(`[backend] ${data}`));
  backendProcess.stderr.on('data', (data) => console.error(`[backend] ${data}`));
}

app.whenReady().then(() => {
  startBackend();
  
  // Wait for backend, then create window
  setTimeout(() => {
    const win = new BrowserWindow({
      width: 1280,
      height: 860,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    win.loadFile('dist/index.html');
  }, 3000);
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});
```

### Electron trade-offs

- Larger bundle (~200 MB vs ~10 MB for Tauri)
- Higher memory usage (ships full Chromium)
- More mature ecosystem and community
- Easier to find developers with Electron experience
- No Rust toolchain required

---

## CI/CD Pipeline (Recommended)

For automated builds across platforms, use GitHub Actions:

```yaml
# .github/workflows/build.yml
name: Build Chronicle Desktop

on:
  push:
    tags: ['v*']

jobs:
  build-backend:
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install pyinstaller -r backend/requirements.txt
        working-directory: repository/Chronicle
      - run: pyinstaller --name chronicle-backend --onefile desktop_entry.py
        working-directory: repository/Chronicle/backend
      - uses: actions/upload-artifact@v4
        with:
          name: backend-${{ matrix.os }}
          path: repository/Chronicle/backend/dist/chronicle-backend*

  build-tauri:
    needs: build-backend
    strategy:
      matrix:
        os: [macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: dtolnay/rust-toolchain@stable
      - uses: actions/download-artifact@v4
        with:
          name: backend-${{ matrix.os }}
          path: repository/Chronicle/frontend/src-tauri/binaries/
      - run: npm install
        working-directory: repository/Chronicle/frontend
      - run: npx tauri build
        working-directory: repository/Chronicle/frontend
        env:
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_PRIVATE_KEY }}
      - uses: actions/upload-artifact@v4
        with:
          name: installer-${{ matrix.os }}
          path: |
            repository/Chronicle/frontend/src-tauri/target/release/bundle/dmg/*.dmg
            repository/Chronicle/frontend/src-tauri/target/release/bundle/nsis/*.exe
            repository/Chronicle/frontend/src-tauri/target/release/bundle/msi/*.msi
```

---

## Summary Checklist

| Step | Description | Status |
|------|-------------|--------|
| 1 | Bundle Python backend with PyInstaller | Not started |
| 2 | Initialize Tauri in frontend | Not started |
| 3 | Configure sidecar in `tauri.conf.json` | Not started |
| 4 | Write Rust sidecar lifecycle code | Not started |
| 5 | Update frontend API base URL for packaged mode | Not started |
| 6 | Test on macOS (dev mode) | Not started |
| 7 | Test on Windows (dev mode) | Not started |
| 8 | Set up code signing (macOS) | Not started |
| 9 | Set up code signing (Windows) | Not started |
| 10 | Configure auto-updater | Not started |
| 11 | Set up CI/CD pipeline | Not started |
| 12 | Production build and distribution | Not started |

---

## References

- Tauri v2 documentation: https://v2.tauri.app
- Tauri sidecar guide: https://v2.tauri.app/develop/sidecar/
- PyInstaller documentation: https://pyinstaller.org
- Apple notarization: https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution
- Windows Authenticode: https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool
