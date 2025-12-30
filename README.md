# DAEMON Dashboard

A personal developer dashboard with GitHub integration and Google Calendar support. Built as a static site hosted on GitHub Pages with a Cloudflare Worker for OAuth token management.

## Features

- **GitHub Integration**: View your assigned issues and pull requests
- **Google Calendar**: See your next 3 upcoming meetings with **automatic token refresh** (never manually reconnect!)
- **Quick Links**: Fast access to frequently used services (GitHub, Calendar, Gmail, De Morgen, Reddit, AWS, ISMS, Gemini, Chess)
- **Drag & Drop Links**: Reorder quick links by dragging - order is saved locally
- **Google Search**: Integrated search bar (press `/` to focus)
- **Dark/Light Mode**: Toggle between themes with preference saved locally
- **Profile Picture**: Configurable profile picture with custom link
- **Random Quotes**: Programming quotes displayed in the footer
- **Auto-refresh**: Data updates every 5 minutes
- **Real-time Clock**: Current time and date display

## Live Demo

https://berthuygens.github.io/daemon/

## Setup

### GitHub Token

1. Go to [GitHub Settings > Personal Access Tokens](https://github.com/settings/tokens)
2. Click **Generate new token (classic)**
3. Select scopes:
   - `repo` - Access to private repositories (issues, PRs)
   - `read:user` - Read your profile information
4. Copy the generated token (starts with `ghp_`)
5. Open the dashboard, click the settings icon (gear)
6. Paste your token and save

### Google Calendar (with Cloudflare Worker)

The dashboard uses a Cloudflare Worker to handle OAuth token refresh automatically. This means you only need to authenticate once - the Worker handles token refresh forever!

#### Step 1: Google Cloud Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project (or select existing)
3. Enable the **Google Calendar API**
4. Create **OAuth 2.0 Client ID** credentials:
   - Application type: Web application
   - Authorized JavaScript origins: `https://berthuygens.github.io`
   - Authorized redirect URIs: `https://YOUR-WORKER.workers.dev/callback`
5. Note down your **Client ID** and **Client Secret**

#### Step 2: Deploy Cloudflare Worker

```bash
# Install wrangler CLI
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Navigate to worker directory
cd cloudflare-worker

# Create KV namespace for token storage
wrangler kv namespace create "OAUTH_TOKENS"
# Copy the ID and update wrangler.toml

# Set secrets
echo "YOUR_CLIENT_ID" | wrangler secret put GOOGLE_CLIENT_ID
echo "YOUR_CLIENT_SECRET" | wrangler secret put GOOGLE_CLIENT_SECRET

# Deploy
wrangler deploy
```

#### Step 3: Configure Dashboard

1. Open the dashboard settings (gear icon)
2. Enter your Worker URL: `https://YOUR-WORKER.workers.dev`
3. Click "Connect Google Calendar"
4. Authorize with Google

You should now see `✓ Auto` in the calendar header - tokens refresh automatically!

### Calendar Filtering

The following events are automatically filtered out (work locations):
- home, thuis
- office, kantoor, bureau
- HT BXL, VAC GENT

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `/` | Focus search bar |
| `Enter` | Search Google |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  GitHub Pages (Static Frontend)                         │
│  https://berthuygens.github.io/daemon/                  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS requests
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Cloudflare Worker (OAuth Handler)                      │
│  - /auth     → Redirect to Google OAuth                 │
│  - /callback → Exchange code for tokens                 │
│  - /token    → Get fresh access token (auto-refresh!)   │
│  - /status   → Check if authenticated                   │
│  - /logout   → Remove stored tokens                     │
└──────────────────────┬──────────────────────────────────┘
                       │ OAuth 2.0
                       ▼
┌─────────────────────────────────────────────────────────┐
│  External APIs                                          │
│  - GitHub REST API (issues, PRs)                        │
│  - Google Calendar API v3                               │
│  - Google OAuth 2.0                                     │
└─────────────────────────────────────────────────────────┘
```

## Privacy & Security

- **GitHub token**: Stored in browser localStorage only
- **Google refresh token**: Stored securely in Cloudflare KV (encrypted at rest)
- **Google access token**: Cached locally, auto-refreshed via Worker
- **Link order & preferences**: Stored in browser localStorage
- **No tracking**: No analytics or tracking scripts

## Local Development

To run locally:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Tech Stack

- Vanilla HTML/CSS/JavaScript
- HTML5 Drag & Drop API
- Cloudflare Workers (OAuth token management)
- Cloudflare KV (token storage)
- GitHub REST API
- Google Calendar API v3
- Hosted on GitHub Pages

## License

MIT
