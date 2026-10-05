# Water Buddy

A tiny pixel-art buddy who pops into the corner of your screen, reminds you to drink water, celebrates when you do, and leaves. Built with Electron 44.

## Step-by-step: get it running (Windows)

**Step 1. Install the tools (one time).**
1. Install **Node.js 20 or newer** (the LTS version) from https://nodejs.org and accept the defaults.
2. Install **Git** from https://git-scm.com (only needed to download the code).
3. Open **PowerShell** and check: `node --version` and `git --version` should both print a version.

**Step 2. Download the code.**
```powershell
git clone https://github.com/AI-Innovation-India/water_reminder.git
cd water_reminder
```
(No Git? On the GitHub page click **Code > Download ZIP**, unzip it, and open PowerShell inside that folder.)

**Step 3. Install the project's packages.**
```powershell
npm install
```

**Step 4. Try it.** She pops up straight away so you can see everything:
```powershell
npm run demo
```
Fill in your name, how often to remind you, and pick a buddy, then press **Start reminding me**. Later, `npm start` runs it without the instant pop-up.

**Step 5. Check it works (optional).**
```powershell
npm test        # quick unit tests
npm run e2e     # drives the real app end to end (windows flash on screen for about a minute)
```

**Step 6. Install it as a real desktop app (recommended).**
```powershell
npm run dist
```
This takes a few minutes the first time. Then open the new `dist` folder and double-click **Water Buddy Setup 1.0.0.exe**.
1. If Windows SmartScreen says "unknown publisher", click **More info**, then **Run anyway** (the installer is not code-signed).
2. Choose an install folder (or keep the default) and click **Install**.
3. A **Water Buddy** shortcut appears on your desktop and in the Start menu, and the app starts.

**Step 6b. Make her start with Windows.** Right-click the Water Buddy tray icon (a blue drop near the clock; it may be hidden under the `^` arrow, so drag it onto the taskbar) and tick **Launch at login**. This only works in the installed app.

**Step 7. Use it every day.** Everything lives in the tray icon:
| Menu item | What it does |
| --- | --- |
| Drink now / Log water | Count a drink yourself (250, 500, 750 ml) |
| Focus timer | 25/5 or 50/10 minute focus and break timer |
| Play with buddy | Catch-the-drops mini-game |
| Character / Accessory | Switch buddy, put on a hat or shades you have unlocked |
| Settings and stats | Goal, glass size, hours, timezone, other reminders, weekly chart, make your own buddy |
| Hot day / Sounds / Pause | Quick switches |

**Step 8. Uninstall.** Windows Settings > Apps > Installed apps > Water Buddy > Uninstall.

**If something goes wrong**
- *Nothing happens when I run `npm start`*: in some terminals (for example inside VS Code) a variable named `ELECTRON_RUN_AS_NODE` is set. Clear it first: `Remove-Item Env:ELECTRON_RUN_AS_NODE`, then run again.
- *First start is slow*: the first run downloads the Electron program once.
- *I closed the first setup window and she disappeared*: that is on purpose, nothing is configured yet. Start her again and press **Start reminding me**.
- *I can't find her*: look in the tray under the `^` arrow. Starting the app a second time makes her say hi.

Needs Node 20+. macOS 13+ and 64-bit only (Electron 44 requirement). On macOS/Linux use the same steps, and `npm run dist` builds a macOS app / Linux AppImage instead.

## Make your own pixel-art buddy from a picture (step by step)

You can turn any picture you have (a photo, a drawing, a character you like) into a buddy. It stays on your computer.

1. Right-click the tray icon > **Character > Create your own...** (or **Settings and stats > Characters**).
2. Type a **name** for your buddy.
3. Click **Choose standing...** and pick a picture. A picture of one subject on a plain background works best.
4. Look at the preview. Leave **Turn my pictures into pixel art** ticked; it shrinks the picture, limits the colours and draws the dark pixel outline.
   - **Remove the plain background** cuts out a flat-colour background.
   - **Pixel detail** slider: lower = chunkier, higher = more detail.
   - **Make the drinking and celebrating poses for me** adds a glass and sparkles. Or choose your own drinking/celebrating pictures.
5. Tick **Use it right away** and press **Save buddy**.
6. To remove a buddy later: Settings and stats > Characters > **Delete** under it (click twice to confirm).

Only use pictures you have the right to use. Pictures of real people and characters from films or shows belong to their owners, so keep those buddies for your own use and do not publish them.

## How it behaves

- First launch asks for your **name**, **how often**, and **which buddy**. Settings are saved to a `settings.json` in your OS user-data folder.
- She visits every N minutes (default 45) **between 10 AM and 11 PM IST**. That window is measured in IST even if your computer is in another timezone. A reminder that would land after 11 PM waits until 10 AM.
- **Yes, I drank it!** She sips, celebrates with confetti and a glass count, then hops away. **Snooze 10 min** sends her away for 10 minutes without counting a drink.
- She stays on screen until you answer. There is no auto-dismiss on purpose.
- Everything else lives in the tray icon: Drink now, Set up, Set your name, Reminder interval, Character, Pause/Resume, Launch at login, Quit.
- Closing the very first setup without saving quits the app so nothing is left half-configured.

Windows: the tray icon may be hidden under the `^` overflow arrow. Drag it onto the taskbar to pin it.
Linux: the tray needs AppIndicator support, and the transparent window is not click-through there.

## Install it as a desktop app (Windows)

```bash
npm run dist
```

Then double-click `dist\Water Buddy Setup 1.0.0.exe`. It installs Water Buddy, adds a **desktop shortcut** and a Start menu entry, and starts it. After installing, tick **Launch at login** in the tray menu so she is always there. (The installer is not code-signed, so Windows SmartScreen may say "unknown publisher": click More info > Run anyway.)

## Features

- **Daily goal and streaks**: set a goal in ml, log drinks (tray > Log water), see a 7-day chart, best streak and totals in **Settings and stats**.
- **Other reminders**: stretch, eye rest (20-20-20), posture, plus your own custom ones (Settings > Other reminders).
- **Focus timer**: tray > Focus timer (25/5 or 50/10). She taps you when it is time to rest.
- **Hot day / workout mode**: reminds you about 40% more often.
- **Moods**: lines change with the time of day, and she gets worried if you are behind on water.
- **Accessories** unlocked by drinking and streaks: party hat, shades, bow, crown, halo.
- **Colour shift** for any buddy, **sounds** (mute from the tray), and a **catch-the-drops mini-game** (tray > Play with buddy).
- **Settings window** for goal, glass size, active hours, timezone, snooze time and reminders.
- Five built-in buddies: Mochi, Sunny, Kai, Luna and Droppy.

## Make your own character (easiest way)

Tray > Character > **Create your own...** (or Settings and stats > Characters). Name your buddy and pick pictures (PNG, JPG, GIF or WebP). Only **standing** is required. Press **Save buddy**. You can delete your own buddies there too.

## Add your own character (by folder)

Tray > Character > **Add your own...** opens a folder. Copy the `_template` folder, rename the copy, and replace the images:

```
characters/
  robin/
    standing.png     required
    drinking.png     required
    celebrate.png    optional (without it she just hops in her standing pose)
    character.json   optional: {"name": "Robin"}
```

Then Tray > Character > **Reload characters**. Tips: transparent PNGs, same size for all three, pixel art around 32 to 64 px tall looks best (it is scaled up in whole-number steps), under 2 MB each. Folders starting with `_` or `.` and folders missing a required image are ignored.

## Change the hours or timezone

Tray > **Settings and stats...** > Active hours.

## Build an installer

```bash
npm run dist       # Windows installer / macOS app / Linux AppImage, in dist/
```

Launch at login only works in the installed app, not from `npm start`. The macOS build is unsigned.

## Scripts

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests for the scheduling and active-hours logic |
| `npm run e2e` | Drives the real app end to end (setup, reminders, tray menu, characters). On Linux: `xvfb-run -a npm run e2e` |
| `npm run assets` | Regenerates the built-in characters and icons (`pip install pillow`) |

## Credits

Font: Jersey 15 (SIL Open Font License, see `src/fonts/OFL-Jersey15.txt`). Characters and icons are drawn in code by `tools/make_assets.py`.
