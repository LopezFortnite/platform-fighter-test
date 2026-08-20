# Putting Clash Rumble online

Everything the game needs — the page itself and the online multiplayer — is run
by one small program, `server.js`. So you only have to put the project in **one**
place, and online works on its own.

That is why this does not use Cloudflare Pages. Cloudflare Pages can only hand
out files that never change; it cannot keep a program running, and online needs a
program running so the two players can find each other.

---

## Before you upload

Delete the `capture/` folder if it is still there. It is 46 MB of debug
screenshots from development and is not part of the game. Everything else is
about 12 MB.

---

## Step by step

1. Go to **github.com** and make a free account if you do not have one.

2. Make a new repository. Call it anything. Leave it **Public** (Private also
   works, it just needs one extra permission later).

3. Upload the whole project folder to it. GitHub's website lets you drag the
   folder straight onto the page — you do not need to install anything.

   *Do not upload `node_modules` or `capture`.* They are not needed and they are
   what made Cloudflare complain about too many files.

4. Go to **render.com** and sign up with your GitHub account.

5. Click **New** → **Web Service**, and pick the repository you just made.

6. Render will read the `render.yaml` file in this project and fill everything
   in by itself. Just check that it says:

   - Build command: `npm install`
   - Start command: `node server.js`

   Then click **Create Web Service**.

7. Wait a couple of minutes. Render will show you a link that looks like
   `https://clash-rumble.onrender.com`.

That link is your game. Send it to a friend, both of you open it, one picks
**Host** and reads out the 6-digit code, the other picks **Join** and types it
in.

---

## Things worth knowing

**The first visit after a quiet spell is slow.** On Render's free plan the
program goes to sleep when nobody is using it, and takes roughly half a minute
to wake up. After that it is fast. If that annoys you, their cheapest paid plan
removes it.

**Online quality depends on the distance between you.** Both computers run the
match in step with each other, so the game moves at the speed of the slower
connection. Between two people in the same country it feels fine. Across an
ocean it will feel rubbery, and that is not something a setting can fix.

**To update the game later**, upload the changed files to GitHub again. Render
notices and redeploys by itself within a minute or two.

---

## If you ever do want Cloudflare

You can put the game files on Cloudflare Pages and keep only the multiplayer
part on Render. It is faster to load, but it is two things to set up instead of
one, and you have to tell the page where the multiplayer lives by adding this
line near the top of `index.html`:

```html
<script>window.CLASH_RELAY = 'wss://clash-rumble.onrender.com';</script>
```

Not worth it unless loading speed starts to bother you.
