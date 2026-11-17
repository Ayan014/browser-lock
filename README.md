# Browser Lock

A Chromium extension (Manifest V3) that asks for a password every time you open the browser.

## Features
- Full-screen lock window on browser startup; other windows are minimized behind it
- Closing the lock window closes the app, so the next launch asks for the password again
- "Lock now" button in the popup, optional auto-lock after idle time
- Password stored as a salted PBKDF2 (SHA-256, 200k iterations) hash, never in plain text
- Brute-force throttling after 5 wrong attempts

## Install (unpacked)
1. Clone or download this repo
2. Open `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the extension icon and set a password

## Limitations
This is a privacy screen, not strong security. The extension can be disabled from `chrome://extensions`, and the lock screen may appear a moment after the browser opens. Enable "Allow in Incognito" to cover Incognito windows.

## License
MIT
