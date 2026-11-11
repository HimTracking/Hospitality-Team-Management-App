# Maati Living Community Team Desk

A deployable team workspace for Maati Living Community, Sitla · Mukteshwar: tasks, proof photos, property audits, OTA operations, sales pipeline, marketing spend, and daily WhatsApp-ready reports.

## Run locally

1. Install Node.js 18 or newer.
2. Double-click `Start Hospitality Growth Desk.cmd`.
3. Keep its window open and visit <http://localhost:3031>.
4. On first launch, create separate passwords for Akash and Himanshu (8+ characters).
5. Sign in, add team profiles and photos, then assign daily tasks.

The app uses Node's built-in modules and requires no npm install. Passwords are stored as salted hashes. Work records and uploaded photos live under `data/`.

## Install on Android and iPhone

The app is an installable Progressive Web App (PWA), so the same secure web address opens as an app icon on both platforms without maintaining two codebases or paying app store enrollment fees.

- **Android:** open the deployed HTTPS address in Chrome and tap **Install** in the app header or choose **Install app** from Chrome's menu.
- **iPhone/iPad:** open the deployed HTTPS address in Safari, tap **Share**, choose **Add to Home Screen**, then tap **Add**. Safari opens it in an app-style window.

The mobile menu slides in from the left and forms use phone-sized controls. The service worker caches public app files only; signing in, viewing records, uploading proof, and saving changes all need a network connection. PWA install requires HTTPS on the deployed site.

Publishing a separate App Store or Google Play listing is optional. If you later want store apps, Capacitor can package this web app for iOS and Android; that adds native build, device testing, and store review work.

## Included

- Shared admin dashboard for Akash and Himanshu, with separate sign-ins and profile photos
- Role-based accounts for OTA, video, Meta Ads, Google, design, Sales, HR, and Social Media
- Daily task assignments with owner, client, due date, time, priority, completion notes, and required photo proof
- Team directory with avatars, completion totals, role boards, and individual profile photos
- A 100-channel OTA and booking directory with favicon marks, links, and task assignment
- Shared property audit folder covering revenue, rooms, capacity, OTAs, marketing, prices, and recommendations
- Sales pipeline for Travel Agents, Wedding, B2B, and Retreat leads with owner, source, stage, deal value, and follow-up date
- Admin CRM with marketing spend, source attribution, lead pipeline, follow-ups, conversions, account sync, and CSV export
- Daily individual and team reports with WhatsApp share buttons
- Role-aware Scout assistant with short, in-session chat history, plus script drafts and SEO suggestions when an OpenAI key is configured
- Mobile navigation, phone-sized forms, reduced-motion support, and installable PWA files

## Optional service connections

Copy `.env.example` to `.env`, add only the keys you use, and restart the app. For hosted deployment, put the same values in your host's secret settings.

- **Meta Ads:** set `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID`. Use a token with Ads Insights read access. The CRM sync imports daily campaign spend, impressions, clicks, and Meta-reported lead actions.
- **Google Ads:** set the OAuth client ID, secret, refresh token, customer ID, and developer token. The CRM sync imports daily campaign spend and Google-reported conversions. Set the login customer ID when accessing the account through a manager account.
- **Other channels:** enter WhatsApp, OTA, website, referral, and offline spend manually. Log sales leads with their source and campaign to compare channels against pipeline outcomes.
- **Scout AI:** set `OPENAI_API_KEY` to enable chat, social script drafts, and SEO suggestions. Scout uses role instructions and sends the user’s current message plus up to ten recent chat turns to OpenAI. It does not automatically include app records and is not fine-tuned on private team data. Scout chat requests set `store: false`; the API key stays on the server.

Ad reporting is read-only, and syncing is started by an admin for a selected range of up to 90 days. Lead stages and outcomes come from the CRM. Accounts must use INR for combined spend totals. Reports open a prefilled WhatsApp message for an admin to review and send; automatic group delivery is not configured.

## Deploy on Render

The included `render.yaml` is a Render Blueprint for the Node web service. Render deploys from a Git repository, so put this folder in a private GitHub repository, then choose **New → Blueprint** in Render and select that repository. The Blueprint uses a Starter web service and a 1 GB persistent disk mounted at `/var/data`; the app stores its JSON records and uploads under that mount so deploys do not erase them. It also sets a health check at `/healthz` and binds the web server to Render’s public interface.

During Blueprint setup, provide a strong one-time `SETUP_KEY`. After the first deploy, open the Render URL and enter that key on the first-time setup screen while creating the two admin accounts. Add `OPENAI_API_KEY` if Scout should be enabled. Keep API keys and the setup key in Render’s Environment settings; do not commit them to GitHub. Optional Meta and Google credentials can be added there later.

Render’s Starter web service currently starts at about US$7/month; the 1 GB disk adds about US$0.25/month. Render Free web services do not support a persistent disk, so they are not suitable for this app’s built-in JSON storage. Prices can change. See [Render web services](https://render.com/docs/web-services), [persistent disks](https://render.com/docs/disks), and [pricing](https://render.com/pricing).

The current app keeps data in one JSON store and runs as one service instance. Do not scale it to multiple instances. Back up `/var/data` regularly. Existing local records are not copied to a new Render disk automatically; export or migrate them separately before switching the team over.

## Deploy with Docker

The included Docker image runs on port 3031. For a local Docker run, first copy `.env.example` to `.env`, then run:

```sh
docker build -t hospitality-growth-desk .
docker run --name hospitality-growth-desk --env-file .env -e NODE_ENV=development -p 3031:3031 -v "$PWD/data:/app/data" hospitality-growth-desk
```

For a cloud host, deploy the Dockerfile behind HTTPS, set `HOST=0.0.0.0` and `NODE_ENV=production`, provide secrets through the host's environment settings, and mount a persistent volume at `/app/data`. The production session cookie is marked Secure. Keep a backup of the mounted data volume.

This build uses a single Node process and JSON-file storage. Use one app instance with persistent storage; multi-instance hosting requires a shared database and session store. A process restart signs users out. WhatsApp auto-send and automatic lead capture from ad platforms need separate provider setup. HR users and admins can manage a shared volunteer roster from the Volunteer Desk; its contact details are only included in the state response for those roles.

## Backup

Back up the entire `data/` directory or hosted volume. It contains user accounts, tasks, reports, contacts, spend records, audit JSON files, and image uploads.
