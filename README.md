# Reselling HQ (standalone version)

Your own website for the weekly check, listing writer and buyer replies. You can install it on your phone like an app. It runs on your own Claude API key, and only people who know your app password can use it.

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
   - `APP_PASSWORD`: a password you'll type into the app (make it long, it protects your API credit)
4. Click **Deploy**. After about a minute you'll get a link like `reselling-hq.vercel.app`. That's your app.

Optional: if a Claude model name ever stops working, add `CLAUDE_MODEL` (for the weekly check and listings) or `CLAUDE_MODEL_FAST` (for buyer replies) with a current model name from the Claude docs, then redeploy.

## Step 4: Link your Google Sheet (5 minutes)

1. Open your Reselling Tracker in Google Sheets.
2. Click **File, Share, Publish to web**.
3. In the first box choose **Inventory**, in the second choose **Comma-separated values (.csv)**, and click **Publish**. Copy the link.
4. Do the same for the **Expenses** tab and copy that link too.
5. Open your app, tap the **cog** (Settings), enter your app password and paste both links. Click **Save settings**.

A published tab can be opened by anyone who has the exact link, though it isn't listed or searchable. Keep the links private. You can stop publishing at any time from the same menu.

## Step 5: Install it on your phone (1 minute)

- **iPhone:** open your app link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap the **menu**, then **Install app** (or **Add to Home screen**).

Enter your password and sheet links once on each device you use. Report history is saved on each device separately.

## Using it

- **Every week:** open the app and press **Run my weekly check**. It reads your sheet, works out profit and stale stock, and Claude searches the web for upcoming drops, sold prices and niche ideas. It takes 1 to 2 minutes.
- **Listings:** add photos and a line of notes, tap **Write listing**, then copy.
- **Replies:** paste a buyer's message with your price and cost, tap **Draft reply**, then copy.

## Running costs

- GitHub and Vercel: free.
- Claude API: you pay per use from the credit you added. A weekly check with web search, plus a few listings and replies, typically costs pennies to tens of pence per week. Check the current prices on the Claude pricing page, and keep a spend limit set in the Console.

## Making changes later

Edit or replace a file on GitHub (open the file, click the pencil, then **Commit changes**). Vercel updates the live app automatically within a minute.

## Files

- `index.html`: the app
- `api/claude.js`: sends requests to Claude using your secret key
- `api/sheet.js`: reads your published sheet tabs
- `manifest.webmanifest`, `sw.js`, `icon-*.png`: make it installable on your phone
