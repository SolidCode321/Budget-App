# Budget

A personal monthly budget tracker. Plain HTML, CSS and JavaScript: no build step, no server, no database.

Your data is stored in your browser's localStorage, on the device you use it on. Nothing is sent anywhere. Use **Plan & settings → Download backup** regularly, and **Restore from backup** to move your data to another device.

## Files

- `index.html` – page layout and styles
- `app.js` – all the app logic
- `manifest.json`, `icon.svg` – lets you "Add to Home Screen" on your phone
- `vercel.json` – security headers (CSP etc.) for Vercel
- `vendor/exceljs.min.js` – library used to build the Excel report
- `middleware.js`, `package.json` – the login gate (runs on Vercel)

## Login (only you can open the app)

`middleware.js` runs on Vercel before any page or file is served. Without a valid login it only shows the login page. The username and password are **not in the code**: they're read from Vercel environment variables, so they never end up in GitHub or in the browser.

Before (or right after) your first deploy, open your project on vercel.com → **Settings → Environment Variables** and add these three, for the Production environment:

| Name | Value |
|---|---|
| `APP_USERNAME` | your username |
| `APP_PASSWORD` | your password |
| `SESSION_SECRET` | a long random string – run `openssl rand -base64 32` to make one |

Then redeploy (`vercel --prod`, or *Deployments → ⋯ → Redeploy*). Environment variable changes only apply after a redeploy.

- If any of the three is missing, the site shows a "Login isn't set up" message and serves nothing else.
- You stay logged in for 30 days per device. **Log out** is in the top-right corner.
- To change your password: update `APP_PASSWORD` and redeploy.
- To log out every device at once: change `SESSION_SECRET` and redeploy.
- Wrong passwords get a 1-second delay to slow down guessing.

## Deploy to Vercel (free)

**Option A – from your terminal, no Git needed**
1. Sign up at vercel.com (Hobby plan is free).
2. Install the CLI: `npm i -g vercel`
3. In this folder run: `vercel` and answer the prompts (framework: *Other*, no build command, output directory: `.`).
4. Run `vercel --prod` to publish. You get a URL like `your-budget.vercel.app`.

**Option B – via GitHub (auto-deploys on every push)**
1. Create a new GitHub repo and push this folder to it.
2. On vercel.com: *Add New → Project → Import* your repo.
3. Framework preset: *Other*. Leave build command empty. Click *Deploy*.

## Use it on your phone

Open your Vercel URL, then:
- iPhone (Safari): Share → *Add to Home Screen*
- Android (Chrome): menu → *Add to Home screen* / *Install app*

## Month end

On the Month screen, **Close month** downloads an Excel report of that month (Budget, Expenses and Income tabs, with live formulas), then asks before clearing the month's entries from the app. Your plan and the month's totals are kept, so the Year view still works. **Download Excel report only** gives you the file without clearing anything.

The Excel export uses ExcelJS (MIT licence), bundled in `vendor/` so no outside scripts are loaded.

## Notes

- Data on your laptop and on your phone are separate (each browser keeps its own copy). Use backup/restore to copy between them.
- Clearing your browser's site data erases the budget. Keep a recent backup.
- The login protects the site. Your budget data itself still lives in each browser's storage, so it doesn't sync between devices – use backup/restore for that.
- `vercel dev` runs the login locally too; put the three variables in a `.env.local` file (it's git-ignored).
