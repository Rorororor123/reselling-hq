# Reselling HQ — project brief

## Who I am
UK reseller. I sell sealed Pokémon TCG, shoes and clothing on eBay, Vinted and StockX. I am a beginner and cannot code, so explain things in plain English and give click-by-click steps for anything I have to do myself (accounts, settings, deploying).

## What this app is
Reselling HQ: a weekly check (profit, stale stock, Claude advice with web search on drops and niches), a listing writer (photos + notes to eBay/Vinted/StockX listings) and a buyer reply drafter.

Current version: single-page app in `index.html`, Vercel serverless functions in `/api` (`claude.js` calls the Claude API with my key, `sheet.js` reads a published Google Sheet CSV), installable on phones (`manifest.webmanifest`, `sw.js`). Hosted on Vercel from this GitHub repo.

## Where it's going
A public app anyone can sign up for:
1. Built-in spreadsheet (Inventory + Expenses) replacing Google Sheets, with CSV/Excel import and export, mobile-friendly.
2. eBay connected via the official eBay API and OAuth to import sales, fees and postage automatically.
3. Vinted sales imported by reading Vinted sale emails through Gmail (read-only, official Google OAuth), plus CSV import and manual entry.
4. User accounts, private per-user data, encrypted tokens, disconnect and delete-my-data, UK privacy policy and terms.
5. Per-user usage limits on Claude API calls, and a plan for paying for it (free tier plus Stripe paid plan).

The step-by-step plan lives in `PLAN.md` once it's written. Follow it and update it as stages finish.

## Rules
- Never scrape Vinted, StockX or any site against its terms, and never ask users for marketplace passwords. Use official APIs, OAuth, email parsing with consent, or user uploads only.
- Never commit secrets. API keys go in Vercel environment variables only. Use sandbox/test keys for eBay and Stripe while building.
- Work one stage per session. Before writing code, show me the plan for that stage and wait for my OK.
- Test everything you build and tell me what you tested and what you couldn't test.
- Keep the current look (deep teal sidebar, yellow price-tag accent, light and dark mode) and keep it working well on phones.
- UK spelling, £, UK tax year (6 April to 5 April). Tax and money figures are guides, not advice.
- At the end of each session, tell me in plain English what changed, what I need to do (if anything), and how to try it on the Vercel preview link.
