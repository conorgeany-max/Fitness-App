# Putting the app online

The hosted version runs on two free services:

- **Supabase** holds the database and handles sign-in, including two-factor codes.
- **Vercel** serves the website and the small server that talks to Up, SnapTrade, Domain and Anthropic.

Each of you gets your own login. The database itself refuses to show anything to a session that hasn't passed a two-factor check, and it keeps each person's private items away from the other.

Budget about an hour for the first setup. You need a computer with Node 20+ and git, a GitHub account with this repository, and an authenticator app on each phone (Google Authenticator, 1Password, Authy or similar).

## 1. Supabase

1. Create a free account at [supabase.com](https://supabase.com) and a **new project**. Pick the Sydney region. Save the database password somewhere safe; the app never needs it.
2. **Run the schema.** Open SQL Editor → New query, paste the whole of `supabase/migrations/0001_core.sql`, and run it. It should finish without errors.
3. **Turn on two-factor codes.** Authentication → Sign In / Providers → Multi-Factor: make sure **TOTP (app authenticator)** is enabled. Leave phone MFA off.
4. **Email sign-in.** Authentication → Sign In / Providers → Email: keep it enabled and keep **Confirm email** on.
5. **Passwords.** Authentication → Policies (or Attack Protection): set the minimum length to 12 and turn on leaked-password protection if your plan offers it.
6. **Addresses.** Authentication → URL Configuration: set **Site URL** to your Vercel address (step 2 gives you this; you can come back). Add the same address to **Redirect URLs**. Password-reset links only go to addresses listed here.
7. **Keys.** Project Settings → API (or API Keys). You need three values:
   - the **Project URL**;
   - the **anon / publishable** key (safe in the browser);
   - the **service_role / secret** key (server only; anyone holding it can read everything, so it only ever goes into Vercel's environment settings).

The schema adds the shared tables to Supabase Realtime, so when one of you changes something the other's screen updates within a second or two.

## 2. Vercel

1. Create a free **Hobby** account at [vercel.com](https://vercel.com) with your GitHub login.
2. **Add New → Project**, import this repository, and set **Root Directory** to `finance-app`. Vercel reads `vercel.json` for the build, the routes, the security headers and the daily sync.
3. Before the first deploy, open **Environment Variables** and add these (Production and Preview):

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
| `SUPABASE_URL` | Supabase Project URL again |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key. Mark it **Sensitive**. |
| `SERVER_ENCRYPTION_KEY` | Run `openssl rand -base64 32` and paste the output. Mark it **Sensitive**. |
| `CRON_SECRET` | Run `openssl rand -hex 32` and paste the output. Mark it **Sensitive**. |
| `PUBLIC_URL` | Your site's address, such as `https://our-money.vercel.app`. Optional on Vercel, which provides it, but set it if you add your own domain. |
| `ANTHROPIC_API_KEY` | Optional, for the assistant (section 5). Mark it **Sensitive**. |
| `AI_MONTHLY_CAP_AUD` | `10` |
| `DOMAIN_CLIENT_ID`, `DOMAIN_CLIENT_SECRET` | Optional, for the screener's Domain search (section 6). |

4. **Deploy.** When it finishes, open the address Vercel gives you and go back to Supabase step 6 to set the Site URL.
5. Check `https://<your address>/api/health` says `{"ok":true,...}`.

**Keep `SERVER_ENCRYPTION_KEY` safe.** It encrypts your Up tokens and SnapTrade keys in the database. If you change or lose it, the stored tokens can't be read, and each of you will need to reconnect.

The daily sync runs once a day (about 4 to 5 am Sydney time). Vercel's free plan allows one daily job and picks the exact minute itself. Up also pushes new transactions as they happen through a webhook, so the daily run is a safety net.

## 3. Your logins

1. Open the site and **Create an account** with your email and a password of at least 12 characters. Confirm the email.
2. Sign in. The app shows a QR code: scan it with your authenticator app and type the six-digit code. From now on every sign-in asks for a code.
3. Choose **Start a household**. Go to **Settings → Household** and create an **invite code**.
4. Your partner creates their own account on the same site, sets up their own authenticator, chooses **Join a household** and enters the code. Codes expire after 7 days and work once.

Nothing either of you marks as private is visible to the other. Each of you chooses separately whether your private items count towards the household totals.

**Lost phone?** There is no self-service reset, on purpose. In Supabase, go to Authentication → Users, open the person, and remove their MFA factor. They can then sign in with their password and scan a new QR code. Only someone with access to the Supabase project can do this.

## 4. Connecting Up and your shares

**Up (each of you does this for yourself):**

1. In the Up app, or at [api.up.com.au](https://api.up.com.au), create a **Personal Access Token**.
2. In the website, **Settings → Connections → Connect Up**, paste the token, and choose whether new accounts start as shared or private.

The token lets the app read your accounts and transactions. Up's token can also change a transaction's category and tags, though it cannot move money; this app never calls those parts of the API. You can revoke the token in the Up app at any time, and **Disconnect** in the website deletes it from the database.

**Shares and ETFs (SnapTrade, optional):**

1. Sign up for SnapTrade's free **Personal** plan at [snaptrade.com](https://snaptrade.com) and connect your broker (Stake, CommSec, Interactive Brokers and others) in SnapTrade's own dashboard.
2. Copy your **Client ID** and **Consumer Key**.
3. In the website, **Settings → Connections → Shares and ETFs**, paste both.

SnapTrade connections are read-only here: the app reads accounts and holdings and never places trades.

**Super:** download your latest statement PDF from your fund and use **Net worth → Super statement**. The PDF is read in your browser and never uploaded; you confirm the balance before it's saved.

## 5. The AI assistant (optional)

1. Create an account at [console.anthropic.com](https://console.anthropic.com), add a payment method and buy a small amount of credit (US$5 is plenty to start).
2. Under **Limits**, set a monthly spend limit of US$7 as a second safety net.
3. Create an API key and add it to Vercel as `ANTHROPIC_API_KEY`, then redeploy.
4. Each of you turns the assistant on for yourself on the **Ask** page.

Anthropic doesn't train its models on API traffic. The assistant sees only the totals listed on the Ask page, never accounts, transactions or tokens, and it can't change anything. The app stops answering for the month once the household's A$10 limit would be reached, counting each question at the most expensive possible price.

## 6. Domain search (optional)

1. Sign in at [developer.domain.com.au](https://developer.domain.com.au), create a project and request access to the **Listings Management / Agents & Listings** API on the free tier. Domain reviews requests by hand.
2. Once approved, create **client credentials** with the `api_listings_read` scope, and add them to Vercel as `DOMAIN_CLIENT_ID` and `DOMAIN_CLIENT_SECRET`.

Until then, pasting listings into the screener works the same way.

## 7. Updates

Every push to the branch Vercel watches redeploys the site. If a later version adds a file in `supabase/migrations/`, run it in the SQL Editor before (or right after) the deploy.

## What it costs

| Item | Monthly | Notes |
|---|---|---|
| Vercel Hobby | free | For personal, non-commercial use. |
| Supabase Free | free | 500 MB database. Free projects pause after a week with no activity; the daily sync keeps it active. No automatic backups. |
| Up API | free | |
| SnapTrade Personal | free | |
| Domain API | free tier | If approved. |
| AI assistant | up to A$10 | Hard limit set by `AI_MONTHLY_CAP_AUD`. Roughly A$0.05–0.15 a question. |
| **Total** | **A$0–10** | |

**Recommended once real data is in:** Supabase Pro (about US$25, roughly A$40 a month) adds daily backups and removes the pause. Until then, use **Settings → Data → Export backup** now and then to keep your own copy.
