# Reselling HQ: build plan

Status: Stages 1 and 2 are done. Stage 3 is built and confirmed on the preview; last check is signing in on the live app after merging. Next up: Stage 4 (built-in tracker and new look), redefined on 19 October 2026 and built in two halves. The stage order changed on 18 October 2026, see section 2.
All prices are rough guides from October 2026 at about $1 = £0.78. Check the live pricing pages before you rely on them. Tax and money figures are guides, not advice.

## Things to do now (before Stage 2)

1. **Sign up for the eBay Developers Program** (free; approval can take a day or two).
   - Go to developer.ebay.com and click **Register**.
   - Choose an **Individual** account and fill in your details. Use the same email as your other app accounts.
   - Confirm your email, then sign in. You don't need to create any keys yet; we'll do that together in Stage 5.
2. **Request your Vinted data export** (it can take a while to arrive).
   - In Vinted (website or app): **Profile, Settings, Privacy settings, Download account data** (menu names can vary slightly).
   - Vinted emails you a download link. Save the file somewhere safe on your computer. Don't upload it to GitHub, it contains personal details.
3. **Save some real Vinted sale emails as test samples.**
   - In Gmail on a computer, open a Vinted "item sold" email, click the three dots (top right of the email), then **Download message**. It saves a `.eml` file.
   - Aim for 5 to 10 different kinds: a normal sale, a bundle, a cancelled order, a "money is in your balance" email, and anything else that looks different.
   - Keep them on your computer, not on GitHub. In Stage 6 I'll make anonymised copies (names and addresses removed) for the tests.
4. **StockX (if you sell there):**
   - Check your seller level in your StockX account. StockX only gives developer (API) access to Level 3 sellers and above, on request.
   - Download your sales history: in **StockX Pro**, open **History** (sales history), click **Export** above the table, and StockX emails you a CSV link ("Your Selling History Is Ready"). It covers the last two years. Keep it for testing in Stage 9.
5. Keep a monthly spend limit set in the Claude Console (you set one up when you started).

## Where we start from
- `index.html`: every screen and all the logic. Settings, password and past reports are saved in the browser, so each phone has to be set up separately.
- `api/claude.js`: sends prompts to Claude with your key. One shared password protects it.
- `api/sheet.js`: reads your published Google Sheet tabs.
- Hosted free on Vercel. You pay Claude per use.

We keep what works (the weekly check maths, the prompts, the listing writer, the reply drafter, light and dark mode, installing on phones) and build the public app around it, one stage at a time. From Stage 4 the look changes to black and purple (the design files in `design/`).

## 1. Recommended tech stack and hosting

| Part | Choice | Why it suits a beginner |
|---|---|---|
| Hosting and server code | **Vercel** (what you already use) | Every GitHub push gets its own preview link automatically. No servers to look after. |
| Database, logins, file storage | **Supabase** (London region) | One dashboard for user accounts and the database. Its "row level security" means the database itself stops one user reading another user's data. |
| App code | Keep the current plain HTML and JavaScript, split into a few files, with no build step | Avoids a full rewrite and a build step. Small libraries only where they save real work: Supabase's client, Papa Parse (CSV) and SheetJS (Excel). |
| Claude | Claude API through the official Anthropic SDK, on the server only | Your key never reaches a phone. Sonnet 5.5 for the weekly check and listings, Haiku 5.5 for buyer replies (as now). |
| Payments | **Stripe** (Checkout plus the Customer Portal) | Stripe hosts the payment and "manage my plan" pages, so we never handle card details. |
| Emails (login links, backups, receipts) | **Resend**, sending from your own domain | Supabase's built-in email is for testing only and won't email real users. |
| Domain | e.g. `resellinghq.co.uk` from Cloudflare | Google, eBay and email sending all need a proper domain with a privacy policy on it. Cloudflare also gives free backup storage (R2) and email routing. |
| Tests | Vitest (maths, parsers, limits) and Playwright (clicks through the app in a real browser) | Every stage ends with tests that run automatically. |

Security basics from day one: secret keys only in Vercel environment variables; eBay, StockX and Google tokens encrypted (AES-256-GCM) before they're saved; sandbox/test keys for eBay and Stripe until launch.

### Monthly running costs (rough guide)

Assumptions: about half of free accounts use the app in a given month, about 1 in 8 accounts pays, and Claude costs roughly 16p per weekly check (with web search), 3p per listing with photos and well under 1p per buyer reply. That works out at about **60p a month per active free user** and **£1.50 per typical paying user** (the limits in section 5 cap both).

| | 10 users (private beta, all free) | 100 users | 1,000 users |
|---|---|---|---|
| Vercel | £0 (Hobby) | £16 (Pro: needed once you charge money, Hobby is non-commercial only) | £16 to £40 |
| Supabase | £0 (Free, no backups, so we run our own weekly export) | £20 (Pro: daily backups, never pauses) | £20 to £45 |
| Domain | about £1 | about £1 | about £1 |
| Emails (Resend) | £0 | £0 | £0 to £16 |
| Backup storage (Cloudflare R2) | £0 | £0 (not needed once on Supabase Pro) | £0 |
| Claude API | about £10 | about £50 | about £450 |
| Stripe fees (1.5% + 20p per UK card payment) | £0 | about £5 | about £40 |
| Google security check (only if we use Gmail sign-in, see section 4) | £0 | £50 to £100 (an annual fee of about £600 to £1,200, spread over 12 months) | £50 to £100 |
| **Total** | **about £10 to £15** | **about £90 without Gmail sign-in, £140 to £190 with** | **about £600 to £700** |
| Income at £6.99 a month | £0 | about £105 (15 payers) | about £910 (130 payers) |

Also yearly: the UK data protection fee to the ICO (£52 a year for small businesses, due before anyone else uses the app).

## 2. The stages, in order

One stage per session. At the start of each session I show you the plan for that stage and wait for your OK. At the end I tell you what I tested, what I couldn't test, and how to try it on the preview link.

**Who can use the app:** until Stage 8 (privacy policy, terms and ICO registration) is finished, **only you use the app. No beta invites before then.** Usage limits (Stage 7) and Stage 8 must both be done before anyone else gets access.

**Order changed on 18 October 2026** so you get built-in tracking and automatic eBay and Vinted syncing for your own account sooner. Usage limits and the privacy policy only matter once other people use the app; while it's just you, your Claude spend is capped by the monthly limit in the Claude Console and the allow list keeps everyone else out. Old numbers: eBay was 7, Vinted was 8, usage limits were 5, privacy was 6. StockX CSV import and the automatic weekly backup moved out of the tracker stage to later stages, and login emails from your own domain moved to the privacy stage.

### Stage 1: Plan (this document)
Done when: PLAN.md is in the repo and you're happy with it.

### Stage 2: Foundations
- Split `index.html` into a few tidy files (screens, styles, logic) without changing how anything looks or works.
- Add automated tests for the existing weekly check maths (profit, stale stock, tax year dates, CSV reading).
- Create the Supabase project (empty for now) and connect it to Vercel preview deployments.
- Update the Claude web search tool to the current version.

Done when: the preview link looks and behaves exactly like today, tests run and pass, and Supabase is connected.

Finished (18 October 2026): `index.html` is now `index.html` + `css/styles.css` + `js/core.js` (maths) + `js/app.js` (screens); screenshots of every screen before and after the split match pixel for pixel. 48 unit tests (Vitest) and 12 browser tests (Playwright, phone light/dark and desktop) run on every push via GitHub Actions, and pass. Web search is now `web_search_20260209`, and if Claude ever rejects it the app says so plainly. `/api/health` shows which settings are set and confirms the Supabase connection: confirmed `supabase: ok` on the preview. Supabase settings (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) must be added inside the project's own Settings; `SUPABASE_URL` is just `https://<ref>.supabase.co`. The publishable key is Preview only for now; the secret key is added in Stage 3.

### Stage 3: Accounts and private data (only you use the app)
- Sign in with email (a link or a 6-digit code) or an optional password, using Supabase Auth. While it's only you, Supabase's built-in email sends the sign-in emails (it only sends to your Supabase team's email and a few an hour). Emails from your own domain (Resend) move to Stage 8.
- Database tables for profiles, settings and reports, with row level security so each user only ever sees their own rows.
- Settings and past reports move from the browser into your account, so every device shows the same data. A one-tap "move this device's data into my account" for what's already saved on a phone.
- The shared `APP_PASSWORD` is replaced by real logins. Sign-up is locked to an allow list that contains **only your email** until Stage 8 is done.
- Basic "download my data" and "delete my account".

Done when: two test accounts (both yours) can't see each other's data (proven by an automated test), settings follow you between phone and laptop, deleting an account removes all its rows, and anyone not on the allow list is refused.

Built (18 October 2026). Confirmed on the preview (19 October): sign-in works, a second test account saw none of your data and deleting it removed it, and the Supabase settings are ticked for Production too. Last check: sign in on the live app after merging. What was built: `supabase/migrations/001_accounts.sql` (tables, security rules, allow list, sign-up check), `js/account.js` (sign-in screen, settings and reports in your account, move old data, download, delete), `api/_supabase.js` (every server function checks the sign-in and the allow list), `api/account.js` (delete), `api/config.js`. 72 unit tests (including 11 that run the real security rules in a test database and prove one account can't see, change or delete another's rows) and 42 browser tests (phone light/dark and desktop, against a pretend Supabase) pass. `/api/health` now also reports `accounts`. `APP_PASSWORD` is no longer used; delete it from Vercel only once sign-in works on the live app.

### Stage 4: Built-in tracker and new look (only you use the app)
Redefined on 19 October 2026: **no spreadsheets.** Everything is managed inside the app with screens, forms and cards. The look and layout follow the design files in `design/` (`Main.dc.html`, `Orders.dc.html`, `Phone.dc.html`): black and purple, Bricolage Grotesque headings, Figtree text, IBM Plex Mono numbers, with a matching light mode. The teal and yellow theme is replaced everywhere. The numbers in the design files are examples only; the app shows your own data. Our own original design, not copied from any other app.

- **Database:** Items (stock and sales), Orders and Expenses tables, each private to its owner (row level security), deleted with the account.
- **Dashboard (home screen):**
  - Profit for this week, this month and this tax year, with a revenue and profit chart (7 days, 30 days, 90 days, this month, all time; show revenue, profit or both).
  - Pending orders: how many are on the way, money committed, age of the oldest.
  - Stock: items held, cost, estimated value.
  - Pre-orders: a separate status for paid-but-not-released items.
  - Monthly profit goal with a progress ring.
  - Best seller this month (by units, profit or revenue).
  - Expenses overview: one-off vs recurring (subscriptions, proxies, software), this month's total, biggest cost, tax-deductible total.
  - Recent activity feed (orders, sales, pre-orders with status labels).
  - A "needs action" list (stale listings, sales to post, missing info).
  - Breakdown by platform and by category.
  - Choose which dashboard boxes show.
  - Phone-friendly, matching `Phone.dc.html`, with a bottom tab bar and a + button for quick adding.
- **Orders screen** (matching `Orders.dc.html`): counts per status, filters, search, and each order with shop, order number, date, cost, courier, tracking number and a progress bar. Orders are added by hand for now; a delivered order moves into stock with one tap.
- **Inventory, Sales and Expenses screens** with cards and forms (tap to edit, quick "mark as sold", "mark posted"), and Expenses that can be one-off, monthly or yearly, tax-deductible or not.
- **The weekly check reads the built-in tracker.** The Google Sheet link and "Use CSV files instead" are removed from the weekly check and Settings.
- **Optional extras only:** bring in an old tracker from a CSV file (with a preview and duplicate check), and a Download backup button (Excel). The automatic emailed weekly backup is in Stage 8.

Built in two halves, with a preview after each:
1. First half: this plan update, design files moved into `design/`, the database file, the dashboard maths, the new look, the Dashboard and the Orders screen.
2. Second half: Inventory, Sales, Expenses, the full quick add, Settings changes, the weekly check reading from the tracker, then the optional extras if they stay small.

First half built (19 October 2026), waiting for your check on the preview:
- **What was built:**
  - `supabase/migrations/002_tracker.sql`: orders, items and expenses tables, plus "move into stock" done in one step.
  - `js/core.js`: the dashboard maths.
  - `js/tracker.js`: the Dashboard, the Orders screen and the order form.
  - The new look in `css/styles.css`, and new purple icons.
  - On phones: a bottom tab bar, a More menu and a + button.
  - The weekly check is now its own screen.
- **Tests (all passing):**
  - 35 new unit tests, including the security rules for the new tables run in a test database.
  - 12 new browser tests (adding, moving and stocking orders; dashboard figures, goal, chart and Customise; the setup message).
- **Your one setup step:** run `002_tracker.sql` in Supabase.

Done when: you can add orders, move them into stock, sell items and log expenses on your phone; the dashboard and weekly check show the right numbers from the app's own data; and another account can't see any of it (proven by an automated test).

### Stage 5: eBay sync (your account first)
- "Connect eBay" button using eBay's official OAuth sign-in (the user logs in on eBay's own site, we never see their password).
- Import sold orders (Fulfillment API) and fees and postage (Finances API) for the UK site. Match them to inventory items, or create new ones for you to review.
- Automatic refresh once a day, plus a "Sync now" button. Refresh tokens stored encrypted.
- eBay's required account-deletion notification endpoint, and a Disconnect button that deletes eBay data.
- Built and tested on the eBay sandbox first, then we apply for production access and connect **your own** eBay account.
- eBay asks for a privacy policy address before it issues production keys, so this stage adds a short "private app, used only by its owner" privacy page. The full UK policy comes in Stage 8, before anyone else uses the app.
- We store no buyer names or addresses: only item, price, fees, postage and dates.
- eBay's sign-in needs a fixed web address to return to, so eBay connects on your live address (still locked to the allow list).

Done when: a sandbox account's sales, fees and postage import correctly with no duplicates on re-sync, disconnecting removes the tokens and data, the deletion endpoint passes eBay's check, and your own eBay sales arrive in the tracker.

### Stage 6: Vinted sync without Google approval (your account first)
- **Your own domain:** you already own one, so we use it with subdomains (for example `in.` for incoming sale emails and later `mail.` for sending), rather than buying a new one. You tell me the domain and where it's registered at the start of this stage, and I give click-by-click steps for the email routing on it.
- **Email forwarding:** each user gets a private address (e.g. `sales-ab12cd@in.yourdomain.co.uk`). They set up a Gmail filter that forwards only Vinted sale emails to it. We read those emails with fixed rules (not AI), pull out item, price, fees and date, and add them for the user to confirm.
- **Gmail's confirmation code:** before Gmail forwards anything, it sends a confirmation email (from forwarding-noreply@google.com, with a 9-digit code and a link) to the forwarding address. The app spots that email, and the setup screen shows the code and the link straight away, so the user never has to dig for it.
- **Click-by-click setup steps shown in the app** (Gmail filters can only be set up on a computer, not the Gmail phone app):
  1. In Reselling HQ, open **Vinted, Set up forwarding** and click **Copy my address**.
  2. In Gmail on a computer, click the **cog** (top right), then **See all settings**.
  3. Open the **Forwarding and POP/IMAP** tab and click **Add a forwarding address**.
  4. Paste your Reselling HQ address, click **Next**, then **Proceed**, then **OK**.
  5. Back in Reselling HQ, the setup screen now shows your **confirmation code** (usually within a minute). Copy it.
  6. In Gmail, paste the code into the box next to the address and click **Verify**. Leave the setting on **Disable forwarding** (this stops all your other email being forwarded; only the filter below forwards).
  7. Click **Save Changes** at the bottom.
  8. In the Gmail search bar, type the search the app gives you (for example `from:vinted subject:sold`) and press the **filter icon**, then **Create filter**.
  9. Tick **Forward it to**, choose your Reselling HQ address, and click **Create filter**.
  10. Back in Reselling HQ, click **Send a test**: the app tells you once it receives a Vinted email.
  If the code doesn't show up within 5 minutes, the screen offers a "Resend from Gmail" tip and a check list.
- **Retailer order emails too:** order confirmations, shipping, out for delivery, delivered and cancellation emails forwarded from shops update the Orders screen, with the statuses Ordered, Shipped, Out for delivery, Delivered and Cancelled. A new order email creates the order; later emails move it along by order number.
- **Vinted CSV import** (from the data Vinted lets you download) and quick manual entry.
- Tests built from anonymised copies of your real Vinted emails, so we spot it quickly if Vinted changes its email layout. Any email (Vinted or retailer) we can't read goes into a "please check" list rather than being guessed.

Done when: the Gmail confirmation email is caught and its code shown (tested with a sample confirmation email), sample Vinted emails turn into correct sales, sample retailer emails create and update orders, unreadable emails land in the check list, and CSV and manual entry work. No Google approval is needed for any of this.

### Stage 7: Claude usage limits and cost tracking (must be done before anyone else uses the app)
- Every Claude call goes through one server function that checks the user's plan and what they've used this month, then records the tokens used (from Claude's own usage figures).
- The app shows "3 of 4 weekly checks left this month" and so on.
- A global safety switch: if total Claude spend for the day passes a set amount, Claude features pause and you get an email. Plus the monthly spend limit in the Claude Console as a backstop.
- An admin view (only you) showing Claude cost per user this month, so we can check the margin target in section 5.

Done when: a test user is blocked cleanly at their limit (with a friendly message), usage is recorded correctly, and the kill switch works in a test.

### Stage 8: Privacy policy, terms, ICO and own-domain emails (after this, a small beta can start)
- A UK GDPR privacy policy, terms of use and cookie notice (we only use essential cookies, so no consent banner is needed), written in plain English for you to check. They're templates, not legal advice.
- A "Your data" page: what we store, connected accounts, disconnect buttons, export, delete everything.
- You register with the ICO and pay the data protection fee.
- **Sign-in emails from your own domain** through Resend (for example from `mail.` on your domain), because Supabase's built-in email only reaches your own address.
- **Automatic weekly backup** (moved from Stage 4): every Sunday night a scheduled job (Vercel Cron) exports each user's data, emails it to them as an Excel attachment, and saves a copy in separate storage outside Supabase (Cloudflare R2), keeping the last 8 weeks. It runs until we move to Supabase Pro (daily backups), then we switch it off.
- Once all of this is live, you can add beta testers to the allow list (up to about 10, all on the free plan).

Done when: the policy pages are live on your domain, delete-my-data removes everything (tested), the ICO registration is done, sign-in emails arrive from your domain, and a test run of the weekly backup arrives by email and in R2 and can be re-imported. Google needs this before it will approve the app.

### Stage 9: StockX sales import from CSV (moved from Stage 4)
- Reads the StockX Pro sales history export (StockX Pro, History, Export, then the emailed link; last two years). Brings in item, size, sale price, fees, payout and sale date, and matches them to inventory items. Click-by-click steps in the app.

Done when: your real StockX CSV imports correctly, with no duplicates when you import it again.

### Stage 10: StockX connection (only if StockX approves us)
StockX has an official seller API (orders, listings, catalogue), but it is only given out by request, to Level 3 sellers and above, and it's aimed at high-volume sellers. It's not clear yet whether StockX lets a third-party app like ours connect other sellers' accounts. So:
- Before this stage, you request developer access from StockX (if you're Level 3+) and we ask whether a multi-user app is allowed.
- If approved: "Connect StockX" using StockX's official OAuth sign-in, daily import of completed sales with fees and payouts, encrypted tokens, Disconnect deletes the data.
- If not approved: we skip this stage. The StockX CSV import from Stage 9 stays as the way in.

Done when: either a test StockX account's sales import correctly with no duplicates and disconnect works, or we've recorded StockX's answer here and skipped it.

### Stage 11: Gmail connection (optional, read-only)
- "Connect Gmail" with Google's official OAuth and the read-only Gmail permission, searching only for Vinted sale emails and using the same parser as Stage 6.
- Runs in Google's "testing" mode for up to 100 invited users with no Google review needed. Full verification and the yearly security assessment only once enough people want it to justify about £600 to £1,200 a year (see section 4).

Done when: a test Gmail account imports Vinted sales, disconnecting revokes access with Google and deletes the data, and the verification paperwork (demo video, wording, policy) is ready to submit.

### Stage 12: Paid plan with Stripe
- Free and Pro plans (section 5). Stripe Checkout to upgrade, Stripe Customer Portal to cancel or change card, and Stripe webhooks keep the user's plan up to date.
- Usage limits from Stage 7 switch automatically when someone upgrades or cancels.
- UK customers only at launch, to keep VAT simple (you don't charge VAT until your total UK turnover passes £90,000; selling to EU consumers would need EU VAT registration from the first sale).
- Move to Supabase Pro and Vercel Pro at this point (you're now charging money), and switch off the automatic weekly backup job from Stage 8. The Download backup button stays.
- Built entirely in Stripe test mode with test cards.

Done when: a test card upgrades an account, limits change straight away, cancelling downgrades at the end of the period, and a failed payment is handled properly.

### Stage 13: Public launch
- A security review of the whole app (row level security, token encryption, rate limiting, error messages that don't leak data).
- Error alerts (Sentry, free tier), uptime check, Supabase daily backups confirmed.
- Check the real Pro margin from the Stage 7 admin view against the target in section 5 and adjust limits or price if needed.
- Switch eBay to production keys and Stripe to live mode. Remove the allow list and open sign-ups.
- Update README and the in-app help for the new public app.

Done when: the security checklist passes, live keys are in, a real person can sign up, import, connect eBay, run a weekly check and pay, all on a phone.

### Optional stages (any time after the stages they depend on)

#### Stage 14 (optional): orders from your bot's Discord webhook
- Each user gets a private webhook address in Settings to paste into their checkout bot as a Discord webhook. Successful checkout messages are logged as orders (status Ordered) with shop, item, size, price and order number where the message has them.
- Anything the app can't read goes to the "please check" list. The address can be reset at any time, which stops the old one working.

Done when: sample webhook messages from your bot become correct orders, duplicates are ignored, and a reset address stops working.

#### Stage 15 (optional): "Share a win" image
- A button on the Sales screen makes an image of recent sales (item, platform, profit or just "sold", your choice) to save or share to Discord. Made on your phone, no Claude cost. No buyer details, ever.

Done when: the image looks right on phone and desktop and shows only what you chose.

#### Stage 16 (optional, needs Stage 7): "Ask the assistant"
- A box on the dashboard that answers questions about your own data ("what was my best month?", "how much have I spent on proxies this tax year?") using Claude. Only your own figures are sent, and each question counts towards the usage limits from Stage 7.

Done when: answers match the app's own numbers for a set of test questions, and questions are counted and capped.

## 3. Accounts you'll need, and when

| Account | Needed by | Cost | Notes |
|---|---|---|---|
| GitHub, Vercel, Claude Console | You already have these | | Keep a monthly spend limit set in the Claude Console. Your Claude "usage tier" rises as you buy credit, which lifts rate limits for more users. |
| **eBay Developers Program** | Now (see "Things to do now"), used in Stage 5 | Free | Gives sandbox and production keys. We create a sandbox test user in Stage 5. |
| **Supabase** | Stage 2 | Free, then $25 a month from Stage 12 | Choose the London region. |
| **Your own domain** (you already own one) | Stage 6 (incoming Vinted emails on a subdomain like `in.`), Stage 8 (sending from a subdomain like `mail.`, policy pages) | Whatever you pay now | We'll check where it's registered in Stage 6. Cloudflare (free) may handle the email routing, and R2 backup storage in Stage 8. |
| **Resend** (email sending) | Stage 8 | Free up to 3,000 emails a month | Linked to your domain. |
| **ICO data protection fee** | Stage 8 | £52 a year | ico.org.uk, "Register (pay the fee)". |
| **StockX developer access** | Request before Stage 10 (Level 3+ sellers only) | Free | Optional; CSV import works without it. |
| **Google Cloud** | Stage 11 | Free (the security assessment costs extra if we go past 100 users) | Project, OAuth consent screen, Gmail API turned on. |
| **Stripe** | Stage 12 (test mode). Live needs your ID and bank details. | No monthly fee, about 1.5% + 20p per UK card payment | Fine as a sole trader. |
| Sentry (optional) | Stage 13 | Free tier | Error alerts. |

I'll give click-by-click steps for each one in the session where it's needed.

## 4. What could stop eBay, Google or StockX approving the app

### eBay
| Risk | How we handle it |
|---|---|
| Production keys stay switched off until you subscribe to (or opt out of) eBay's account-deletion notifications | We build the notification endpoint in Stage 5. It answers eBay's check and deletes that user's eBay data when they close their eBay account. |
| The Finances API (fees and payouts) uses a restricted permission that may need eBay to approve it separately | We ask for access as soon as your developer account exists. If it's slow, we import orders first and estimate fees from eBay's published fee rates until it's approved. |
| Daily API call limits | We only fetch what's new since the last sync and store results. If we get big, we apply for eBay's "Application Growth Check" to raise the limits. |
| eBay's licence and branding rules: data used only for the seller's own benefit, never sold, deleted on request, no "eBay" in our app name or logo | Written into the short privacy page (Stage 5), the full privacy policy (Stage 8) and the Disconnect and delete flows. The app is called "Reselling HQ", never "eBay ...". |
| OAuth needs an https sign-in return page and a privacy policy URL | Your live Vercel address and the short private-app privacy page (Stage 5) cover your own account. The full policy on your domain (Stage 8) comes before anyone else connects. |

### Google (Gmail)
| Risk | How we handle it |
|---|---|
| Gmail read-only is a "restricted" permission. Above 100 users Google requires full verification plus a yearly independent security assessment (CASA), about £600 to £1,200 a year and 2 to 8 weeks | We launch Vinted import with email forwarding and CSV (Stage 6), which needs no Google approval at all. Gmail sign-in stays in testing mode (100 invited users max) until demand justifies the cost. |
| Testing mode logs users out of Gmail every 7 days | Acceptable for a small beta. The app shows a "Reconnect Gmail" prompt. |
| Google wants a verified domain, a homepage, a privacy policy explaining exactly how Gmail data is used (including their "Limited Use" wording), a demo video and a reason for the permission | All prepared in Stages 8 and 11. |
| Google's rules restrict sending Gmail content to other services, including AI | We read Vinted emails with fixed rules in our own code and never send email contents to Claude. We only keep the extracted sale details, not the emails. |
| The permission gives access to the whole inbox, which can put users off | We only ever search for Vinted sale emails, say so clearly on the connect screen, and offer forwarding as the more private option. |

### StockX
| Risk | How we handle it |
|---|---|
| API access is by request, Level 3+ sellers only, and may not allow a third-party app connecting other sellers | CSV import (Stage 9) works for everyone regardless. The API stage (Stage 10) only goes ahead if StockX says yes in writing. |
| No scraping or password sharing allowed (our own rule too) | We only use the official CSV export or StockX's own OAuth sign-in. |

## 5. Who pays for Claude, and the options

**You pay the Claude bill** on your Anthropic account. Users never need their own API key. That money has to come back through the paid plan, so every Claude call is counted and capped (Stage 7).

Options considered:
1. **Free tier plus a paid plan (recommended).** Free users get enough to see the value, paying users get more, and the limits mean no single user can run up your bill.
2. Paid only, with a free trial. Lower risk, but fewer people will try it.
3. Users bring their own Claude API key. Cheapest for you, but too technical for most resellers and risky to store. Not recommended.

**Target margin:** every Pro user must leave **at least £2.50 a month after Claude and Stripe costs, even in the worst case** (someone who uses every limit, every month). That £2.50 covers a share of hosting and the free users.

The first draft (£5.99 with 100 listings) broke this: worst case Claude £4.30 + Stripe 29p left only £1.40. So the price goes up slightly and the listing limit comes down:

| | Free | Pro: £6.99 a month |
|---|---|---|
| Weekly checks (with web search, about 16p each) | 4 a month | 8 a month |
| Listings written (about 3p each) | 10 a month | 75 a month |
| Buyer replies (well under 1p each) | 30 a month | 300 a month |
| Tracker, imports, eBay, Vinted and StockX sync, backups | Unlimited | Unlimited |
| Worst-case Claude cost | about £0.95 | about £3.60 |
| Stripe fee | none | about 30p |
| **Worst-case margin** | (costs you up to £0.95) | **about £3.09** (meets the £2.50 target) |
| Typical margin (about £1.50 of Claude) | | about £5.19 |

Notes:
- **Monthly plan only at launch.** A yearly plan at a discount (say £59) would break the worst-case target, so we only add one once Stage 7's real usage data shows typical users are well under the limits (a yearly price of about £75 or more would meet the target even in the worst case).
- If testing in Stage 7 shows Haiku 5.5 writes good enough listings (around 20 times cheaper than Sonnet), we can raise the listing limit without touching the price.
- We recheck the margin with real numbers from the Stage 7 admin view before launch (Stage 13), and whenever Claude prices change.
- Extra protection: the daily spend kill switch (Stage 7) and the monthly limit in the Claude Console.

## Progress
- [x] Stage 1: Plan
- [x] Stage 2: Foundations
- [ ] Stage 3: Accounts and private data (only you). Confirmed on the preview; tick once sign-in works on the live app
- [ ] Stage 4: Built-in tracker and new look (first half: dashboard and orders; second half: inventory, sales, expenses, weekly check from the tracker)
- [ ] Stage 5: eBay sync for your account
- [ ] Stage 6: Vinted sales and retailer order emails via email forwarding on your own domain, plus manual entry
- [ ] Stage 7: Claude usage limits
- [ ] Stage 8: Privacy policy, terms, ICO, own-domain emails, automatic weekly backup (beta can start after this)
- [ ] Stage 9: StockX CSV import
- [ ] Stage 10: StockX connection (only if StockX approves)
- [ ] Stage 11: Gmail connection (optional)
- [ ] Stage 12: Stripe paid plan
- [ ] Stage 13: Public launch
- [ ] Stage 14 (optional): orders from your bot's Discord webhook
- [ ] Stage 15 (optional): "Share a win" image
- [ ] Stage 16 (optional): "Ask the assistant"
