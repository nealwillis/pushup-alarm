# Pushup Alarm

Pushup Alarm is an alarm clock you open in Safari on an iPad. It keeps ringing until you finish a set of pushups, counted by the front camera. Everything stays on the iPad: there is no account and no server.

It is a website, not an App Store app. You do not need Xcode, a paid Apple Developer account, or a re-sign every 7 days. Add it to the Home Screen once and it stays there.

The iPad does have to stay awake, plugged in, and on this screen overnight. iPadOS will not let a website ring like the built-in Clock app after you leave Safari or lock the screen.

## Add it to the iPad

You need the site on the internet over **https**. The camera will not work from a file you opened, or from an `http://` address.

### 1. Put the site online

**Netlify Drop is the easiest way.** It is free and gives you an https address.

1. On a computer, open [https://app.netlify.com/drop](https://app.netlify.com/drop).
2. If Netlify asks you to sign up, a free account is enough.
3. Find the project folder on your computer — the one that contains `index.html`, `manifest.webmanifest`, and the `js` folder. Do not zip it first.
4. Drag that folder onto the Netlify Drop page.
5. Wait until Netlify shows a site address that starts with `https://`. Copy it.

Other hosts that also work, if you already use them:

- **Cloudflare Pages:** create a project, upload this folder, and use the `https://` address Cloudflare gives you.
- **GitHub Pages:** the public copy is the project site [https://nealwillis.github.io/pushup-alarm/](https://nealwillis.github.io/pushup-alarm/) from the public repo `nealwillis/pushup-alarm`. The manifest `start_url` and `scope` are `/pushup-alarm/`, and the service worker registers against the folder that contains it, so the model, icons, and scripts load under that subpath. Open that address directly (with the trailing slash). If you instead publish this folder at the root of some other host, change those manifest fields and the icon paths from `/pushup-alarm/` back to `./`.

The first time you open the site, the iPad needs a network connection so it can store the app for offline use. After that, the pose model and the app shell are cached on the device. The alarm still only rings while the page is open.

### 2. Open it in Safari on the iPad

1. Copy the `https://` address into **Safari** on the iPad. Chrome and other browsers cannot add a proper Home Screen app on iPadOS.
2. Allow the camera when asked. If you miss the prompt, the steps are below.
3. Tap **Practice pushups** and do a couple of real pushups, so you can see the count before you rely on it in the morning.

### 3. Add it to the Home Screen

1. In Safari, tap the **Share** button (the square with an arrow).
2. Scroll the share sheet and tap **Add to Home Screen**.
3. Leave the name as Pushup Alarm and tap **Add**.
4. Open Pushup Alarm from the new icon, not from the Safari tab. It should fill the screen without the Safari address bar.

There is nothing to trust in Settings → General → VPN & Device Management. That step is only for apps installed from Xcode.

## The night you want it to wake you

The tips are also on the clock screen.

1. Plug the iPad in.
2. Turn the volume all the way up. If headphones are connected, the sound goes there instead of the room.
3. Create an alarm: time, which days, a label, and how many pushups (10 is the default). Leave the days empty if it should ring once and then turn off.
4. Tap **Arm alarm**. That tap is required. It unlocks sound (iPadOS blocks audio that a page starts by itself) and asks the iPad to keep the screen on.
5. Leave Pushup Alarm in front. Do not press the Sleep button, do not swipe home, and do not switch apps.
6. Set a backup in case the screen still dims: **Settings → Display & Brightness → Auto-Lock → Never**.
7. Turn on **Guided Access** so a half-asleep swipe cannot leave the app:
   - **Settings → Accessibility → Guided Access**, turn it on, and set a passcode.
   - Open Pushup Alarm.
   - Triple-click the top button (or the Home button on older iPads) and tap **Start**.
   - In the morning, triple-click again and enter the passcode when you are done.

While it is armed, the clock dims. The slider in Settings controls that dimming. It does not change the iPad’s system brightness, so turn that down as well if the screen is still too bright.

If the alarm time has already passed when you arm it, the next ring is the following matching day. The line under the clock tells you when that is.

## When it rings

The screen switches to the camera. There is no close button. The sound loops until the rep count reaches the number you set.

Prop the iPad on the floor or against a wall, facing you, so your shoulders, elbows, and hips stay in view. A side view is the most reliable. A front view also works if your body moves down, or closer to the iPad, at the bottom of the pushup.

A rep counts only when:

- both elbows bend far enough, and
- your shoulders drop (or you move closer to the camera), and
- you hold the bottom for a moment, and
- you push back up until both arms are straight.

Waving your arms, bending only one arm, or stopping halfway does not count. The two pills on the screen light up when the bottom position and the straight-arm position are seen. Each accepted rep makes a short sound. On phones that support it, the device also vibrates. iPads usually will not vibrate.

**Snooze** pauses the noise. It does not cancel the pushups. When it rings again you still owe the full set.

**Test this alarm**, in the alarm editor, rings for real until you finish that many pushups. **Practice pushups** counts reps without the siren, and you can end practice.

## If the camera is blocked

The challenge screen explains it and does not offer a skip. To allow the camera:

1. Open **Settings → Safari → Camera** and choose **Ask** or **Allow**.
2. Open the site in Safari, tap **aA** in the address bar, tap **Website Settings**, and set **Camera** to **Allow**.
3. Return to Pushup Alarm and tap **Try the camera again**.

If you previously tapped Don’t Allow, step 2 is the one that clears it for this site.

## Emergency stop

Settings has a collapsed section called **Emergency override**. It is off unless you turn it on. Turn it on only if the camera cannot work and you still need a way to silence a ringing alarm. You then have to hold a button for 4 seconds. Leave it off for normal use.

## What will not work

- The alarm does not ring if Safari or the Home Screen app is closed, or if the iPad is locked.
- It is not a backup for the built-in Clock app. Use both if missing the morning would matter.
- Clearing the website’s data in Safari settings deletes your alarms.
- A determined person can turn the iPad off or clear site data. Guided Access and the missing dismiss button are what make it annoying to cheat, not impossible.

## Privacy

The camera picture is drawn on the page and passed to MoveNet in the browser. No video, photo, or alarm is sent to a server. Alarms and settings are stored in the iPad’s local storage for this site.

## Check the project on a computer

You do not need this to use the alarm. If you want to run the tests:

1. Install Node.js 20 or newer.
2. In this folder, run:

```bash
npm test
```

The tests feed fake skeleton points into the rep counter. They check that a full down-then-up counts, and that arm waves, one-arm bends, partial reps, and dips that are too fast do not.

## Project layout

| Path | What it is |
| --- | --- |
| `index.html` | The app |
| `css/styles.css` | Layout for portrait and landscape |
| `js/rep-counter.js` | Pushup counting rules |
| `js/alarms.js` | Times, repeat days, snooze |
| `js/app.js` | Screens, camera, wake lock |
| `js/audio.js` | Looping alarm sound |
| `models/movenet/` | Pose model, stored with the app |
| `vendor/` | TensorFlow.js and the pose library |
| `sw.js` | Offline cache |
| `manifest.webmanifest` | Home Screen install info |

## Third-party software

The pose model is MoveNet SinglePose Lightning and the libraries are TensorFlow.js and `@tensorflow-models/pose-detection`, from Google, under the Apache License 2.0. Their license headers are in `vendor/`. The model and libraries are included in this folder so the app does not depend on a third-party website at alarm time.

## Icons

`tools/generate-icons.mjs` redraws the Home Screen icons if you want to change them:

```bash
node tools/generate-icons.mjs
```
