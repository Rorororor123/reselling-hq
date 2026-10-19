# Reselling HQ (standalone version)

Your own website for the weekly check, listing writer and buyer replies. You can install it on your phone like an app. It runs on your own Claude API key. You sign in with your email, and only emails on the allow list can get in.

## What you need

| Account | Cost | What it's for |
|---|---|---|
| GitHub (github.com) | Free | Stores the app's files |
| Vercel (vercel.com) | Free (Hobby plan) | Puts the app online |
| Claude Console (console.anthropic.com) | Pay as you go | Your API key, which powers the advice, listings and replies |

## Step 1: Get a Claude API key (5 minutes)

1. Go to console.anthropic.com and sign up.
2. Open **Billing**, add a card and buy a small amount of credit (£5 is plenty to start).
3. Open **Limits** and set a monthly spend limit, for example £10, so you can never be surprised.
4. Open **API Keys**, click **Create Key**, name it "Reselling HQ" and copy it. Keep it private and never paste it into the app itself.

## Step 2: Put the files on GitHub (5 minutes)

1. Sign up at github.com.
2. Click **+** (top right) then **New repository**. Name it `reselling-hq`, choose **Private**, and click **Create repository**.
3. Click **uploading an existing file**.
4. Unzip `reselling-hq-app.zip` on your computer. Drag **everything inside the folder** (including the `api` folder) into the GitHub page.
5. Click **Commit changes**.

## Step 3: Put it online with Vercel (5 minutes)

1. Go to vercel.com and choose **Continue with GitHub**.
2. Click **Add New... then Project**, find `reselling-hq` and click **Import**.
3. Open **Environment Variables** and add these two:
   - `ANTHROPIC_API_KEY`: the key from Step 1
   - The Supabase settings in "Accounts" below
4. Click **Deploy**. After about a minute you'll get a link like `reselling-hq.vercel.app`. That's your app.

Optional: if a Claude model name ever stops working, add `CLAUDE_MODEL` (for the weekly check and listings) or `CLAUDE_MODEL_FAST` (for buyer replies) with a current model name from the Claude docs, then redeploy.

## Step 4: Bring in your old tracker (optional, 5 minutes)

1. If your old tracker is a Google Sheet, open it and click **File, Download, Microsoft Excel (.xlsx)**.
2. Open your app, sign in, go to **Settings** and click **Choose files** under **Bring in your old tracker**.
3. Pick the file. The app shows how many stock items, sales and expenses it found; click **Add them**.

It skips anything already in the app, so it's safe to do twice. Once it's in, you can stop publishing the old sheet (in the sheet: **File, Share, Publish to web, Stop publishing**).

## Step 5: Install it on your phone (1 minute)

- **iPhone:** open your app link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the **menu**, then **Install app** (or **Add to Home screen**).

Sign in once on each device. Your stock, sales, settings and report history are saved in your account, so every device shows the same thing.

## Using it

- **Day to day:** add orders when you buy, move them into stock when they arrive, and record sales and expenses. On a phone the **+** button does all of these.
- **Every week:** open the app and press **Run my weekly check**. It reads your stock, sales and expenses from the app, works out profit and stale stock, and Claude searches the web for upcoming drops, sold prices and niche ideas. It takes 1 to 2 minutes.
- **Listings:** add photos and a line of notes, tap **Write listing**, then copy.
- **Replies:** paste a buyer's message with your price and cost, tap **Draft reply**, then copy.

## Running costs

- GitHub and Vercel: free.
- Claude API: you pay per use from the credit you added. A weekly check with web search, plus a few listings and replies, typically costs pennies to tens of pence per week. Check the current prices on the Claude pricing page, and keep a spend limit set in the Console.

## Making changes later

Edit or replace a file on GitHub (open the file, click the pencil, then **Commit changes**). Vercel updates the live app automatically within a minute.

## Accounts (Supabase, from Stage 3)

Sign-in and your saved data live in Supabase (London region). The database only ever lets a signed-in person see their own rows, and only emails on the allow list can create an account.

**Vercel settings** (Settings, Environment Variables), needed for both **Preview** and **Production**:

- `SUPABASE_URL`: your project's URL, like `https://abcd.supabase.co` (Supabase, Project Settings, Data API)
- `SUPABASE_PUBLISHABLE_KEY`: starts `sb_publishable_` (Supabase, Project Settings, API Keys). Safe to be public.
- `SUPABASE_SECRET_KEY`: starts `sb_secret_` (same page). Server only. Never paste it anywhere else.

**Supabase, one time:**

1. **SQL Editor, New query**: paste all of `supabase/migrations/001_accounts.sql`, click **Run**. Then do the same with `supabase/migrations/002_tracker.sql` (your orders, stock and expenses, from Stage 4).
2. Add your email to the allow list (SQL Editor): `insert into public.allowed_emails (email) values ('you@example.com') on conflict do nothing;`
3. **Authentication, Hooks**: add a **Before User Created** hook, type **Postgres**, schema `public`, function `hook_before_user_created`.
4. **Authentication, URL Configuration**: Site URL = your live address; Redirect URLs = your live address and your preview address pattern.
5. Optional: **Authentication, Emails, Magic Link** template: add `{{ .Token }}` so the email also has a code (handy for the installed phone app).

Supabase's built-in email only sends to people on your Supabase team and only a few an hour. Fine while it's just you; Stage 8 switches to Resend on your own domain.

Check it any time at `your-link/api/health`: `"supabase":"ok"` and `"accounts":"ok (1 email on the allow list)"` mean all is well. It never shows your keys or emails.

## Files

- `index.html`: the screens
- `css/styles.css`: the look (black and purple, light and dark mode; the designs it follows are in `design/`, which isn't published)
- `js/core.js`: the weekly check and dashboard maths, and tracker reading
- `js/tracker.js`: the Dashboard and Orders screens and the order form
- `js/stock.js`: the Inventory, Sales and Expenses screens, Download backup and bringing in an old tracker
- `js/xlsx.js`: reads and writes Excel files for the backup and the import
- `js/app.js`: everything that happens when you tap things
- `js/account.js`: sign in, your settings and reports in your account, download my data, delete my account
- `js/vendor/`: Supabase's sign-in library (a pinned copy, so the app doesn't depend on another website)
- `api/claude.js`: sends requests to Claude using your secret key (signed-in, allowed accounts only)
- `api/account.js`: deletes your account and all its data
- `api/config.js`: tells the app where Supabase is
- `api/_supabase.js`: shared sign-in checks for the files above
- `supabase/migrations/`: the database tables and security rules
- `api/health.js`: checks the server's settings and the Supabase connection
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: make it installable on your phone
- `tests/`: automatic checks. They run on GitHub after every change (the green tick or red cross next to each commit)
