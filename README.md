# Water Buddy

A tiny pixel-art buddy who pops into the corner of your screen, reminds you to drink water, celebrates when you do, and leaves. Built with Electron 44.

## Run it

```bash
npm install
npm start          # first launch downloads the Electron binary (Electron 42+ no longer does it at install)
npm run demo       # same, but she pops up straight away so you can see everything
```

Needs Node 20+. macOS 13+ and 64-bit only (Electron 44 requirement).

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
