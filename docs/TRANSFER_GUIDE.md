# CHRONICLE — Transfer Guide

How to prepare CHRONICLE for transfer to another person or machine.

---

## Step 1: Bundle Dependencies (One-Time)

Run `setup_portable.bat` from the Chronicle folder. This creates a Python virtual environment (`venv/`) and installs all backend and frontend dependencies locally so the app can run without separate installation steps on the target machine.

```
Double-click setup_portable.bat
```

> **Prerequisite:** The machine running setup must have Python 3.10+ and Node.js installed. The target machine needs these too unless the OS and architecture match exactly (venv is not cross-platform).

## Step 2: Export Your Data (Optional)

If you want to keep a backup of your data before transferring:

1. Open CHRONICLE (`start.bat`)
2. Go to **Settings → Export Database**
3. Save the exported JSON file somewhere safe

## Step 3: Reset the App

Clear your personal data so the recipient starts fresh:

1. Open CHRONICLE (`start.bat`)
2. Go to **Settings → Reset App**
3. Confirm the reset — this wipes all entries, goals, projects, lessons, and settings

> **Important:** `data/chronicle.db` contains all your personal data (entries, goals, projects, lessons, settings). The reset clears everything and returns the app to the first-launch setup wizard. If you skip this step, the recipient will see your data.

## Step 4: Copy the Folder

Copy the entire `Chronicle/` folder to a USB drive, shared network location, or however you're transferring it. The folder includes everything needed:

- `backend/` — Python API server
- `frontend/` — React app
- `venv/` — Bundled Python environment (from Step 1)
- `frontend/node_modules/` — Bundled frontend dependencies (from Step 1)
- `start.bat` — App launcher
- `data/` — Database folder (empty after reset)

## Step 5: Recipient Starts the App

The recipient:

1. Pastes the `Chronicle/` folder onto their machine
2. Double-clicks `start.bat`
3. The browser opens automatically to the app
4. Completes the **Setup Wizard** (name, role, org, etc.)
5. They're ready to go

---

## Notes

- If the recipient's machine has a different OS or Python version, they should run `setup_portable.bat` again on their machine to rebuild the venv.
- The `data/chronicle.db` file is the single source of all app data. Back it up regularly via **Settings → Export Database**.
