/**
 * DAEMON Dashboard - Google Calendar OAuth Worker
 *
 * This Cloudflare Worker handles Google OAuth token management:
 * - /auth: Redirects to Google OAuth consent screen
 * - /callback: Exchanges auth code for tokens, stores refresh token
 * - /token: Returns a fresh access token using stored refresh token
 * - /logout: Removes stored tokens
 */

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://sysopbeta.be',
  'https://b3.wtf',
  'https://berthuygens.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

// Handle CORS preflight - returns headers for first allowed origin
// Actual request handlers use dynamic origin matching
function handleOptions(request) {
  const origin = request?.headers?.get('Origin');
  const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// OTOBO API endpoint (migrated from OTRS)
const OTOBO_BASE_URL = 'https://ticketing.inbo.be/otobo/nph-genericinterface.pl/Webservice/DaemonAPI';

// Validate API key from Authorization: Bearer <key> header
function validateApiKey(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const key = authHeader.slice(7);
  return key === env.API_KEY;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    // Use origin from request, validate against allowed list
    const origin = request.headers.get('Origin');
    const corsHeader = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    // /auth and /callback are part of the OAuth flow (browser redirects, not fetch)
    // All other endpoints require a valid API key
    const publicPaths = ['/auth', '/callback'];
    if (!publicPaths.includes(url.pathname) && !validateApiKey(request, env)) {
      return jsonResponse({ error: 'Unauthorized' }, 401, corsHeader);
    }

    try {
      switch (url.pathname) {
        case '/auth':
          return handleAuth(env, url);
        case '/callback':
          return handleCallback(request, env, url);
        case '/token':
          return handleToken(request, env, corsHeader);
        case '/logout':
          return handleLogout(request, env, corsHeader);
        case '/status':
          return handleStatus(request, env, corsHeader);
        case '/rss':
          return handleRSS(url, corsHeader);
        case '/otrs/tickets':
          return handleOTRSTickets(env, corsHeader);
        default:
          return jsonResponse({ error: 'Not found' }, 404, corsHeader);
      }
    } catch (error) {
      console.error('Worker error:', error);
      return jsonResponse({ error: error.message }, 500, corsHeader);
    }
  },
};

// Step 1: Redirect to Google OAuth
async function handleAuth(env, url) {
  const state = crypto.randomUUID();
  const redirectUri = `${url.origin}/callback`;

  // SECURITY: Store state in KV with 5-minute TTL for CSRF protection
  await env.OAUTH_TOKENS.put(`oauth_state:${state}`, 'valid', { expirationTtl: 300 });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline', // This gets us a refresh token!
    prompt: 'consent', // Force consent to ensure refresh token
    state: state,
  });

  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

// Step 2: Handle OAuth callback, exchange code for tokens
async function handleCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return htmlResponse(`
      <html><body>
        <h1>Authorization Failed</h1>
        <p>Error: ${escapeHtml(error)}</p>
        <script>setTimeout(() => window.close(), 3000);</script>
      </body></html>
    `);
  }

  // SECURITY: Validate state parameter to prevent CSRF attacks
  if (!state) {
    return htmlResponse(`
      <html><body>
        <h1>Authorization Failed</h1>
        <p>Missing state parameter</p>
      </body></html>
    `);
  }

  const storedState = await env.OAUTH_TOKENS.get(`oauth_state:${state}`);
  if (!storedState) {
    return htmlResponse(`
      <html><body>
        <h1>Authorization Failed</h1>
        <p>Invalid or expired state parameter. Please try again.</p>
      </body></html>
    `);
  }

  // Delete the state to prevent replay attacks
  await env.OAUTH_TOKENS.delete(`oauth_state:${state}`);

  if (!code) {
    return htmlResponse(`
      <html><body>
        <h1>Authorization Failed</h1>
        <p>No authorization code received</p>
      </body></html>
    `);
  }

  // Exchange code for tokens
  const redirectUri = `${url.origin}/callback`;
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    return htmlResponse(`
      <html><body>
        <h1>Token Exchange Failed</h1>
        <p>Error: ${tokens.error_description || tokens.error}</p>
      </body></html>
    `);
  }

  // Store refresh token in KV (we use a simple key for single-user)
  // For multi-user, you'd use a user ID as part of the key
  if (tokens.refresh_token) {
    await env.OAUTH_TOKENS.put('refresh_token', tokens.refresh_token);
  }

  // Store access token with expiry
  const tokenData = {
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
  };
  await env.OAUTH_TOKENS.put('token_data', JSON.stringify(tokenData));

  // Return success page that posts message to opener and closes
  // SECURITY: Only post to explicitly allowed origins (reuse global constant)
  const allowedOriginsJson = JSON.stringify(ALLOWED_ORIGINS);

  return htmlResponse(`
    <!DOCTYPE html>
    <html>
    <head><title>Authorization Successful</title></head>
    <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #0d1117; color: #e6edf3;">
      <div style="text-align: center;">
        <h1 style="color: #3fb950;">Connected!</h1>
        <p>Google Calendar is now connected.</p>
        <p style="color: #8b949e;">This window will close automatically...</p>
      </div>
      <script>
        // SECURITY: Only send OAuth token to explicitly allowed origins
        const allowedOrigins = ${allowedOriginsJson};
        if (window.opener) {
          const message = { type: 'oauth-success', accessToken: '${tokens.access_token}', expiresIn: ${tokens.expires_in} };
          // Post to each allowed origin - browser only delivers to matching origin
          allowedOrigins.forEach(origin => {
            try {
              window.opener.postMessage(message, origin);
            } catch (e) {
              // Origin mismatch is expected for non-matching origins
            }
          });
        }
        setTimeout(() => window.close(), 2000);
      </script>
    </body>
    </html>
  `);
}

// Step 3: Get fresh access token using refresh token
async function handleToken(request, env, corsHeader) {
  // Check for stored refresh token
  const refreshToken = await env.OAUTH_TOKENS.get('refresh_token');

  if (!refreshToken) {
    return jsonResponse({
      error: 'not_authenticated',
      message: 'No refresh token stored. Please authenticate first.'
    }, 401, corsHeader);
  }

  // Check if we have a valid cached access token
  const cachedData = await env.OAUTH_TOKENS.get('token_data');
  if (cachedData) {
    const tokenData = JSON.parse(cachedData);
    // If token is still valid for at least 5 minutes, return it
    if (tokenData.expires_at > Date.now() + 300000) {
      return jsonResponse({
        access_token: tokenData.access_token,
        expires_in: Math.floor((tokenData.expires_at - Date.now()) / 1000),
      }, 200, corsHeader);
    }
  }

  // Refresh the token
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const tokens = await tokenResponse.json();

  if (tokens.error) {
    // If refresh token is invalid, clear it
    if (tokens.error === 'invalid_grant') {
      await env.OAUTH_TOKENS.delete('refresh_token');
      await env.OAUTH_TOKENS.delete('token_data');
    }
    return jsonResponse({
      error: tokens.error,
      message: tokens.error_description || 'Token refresh failed'
    }, 401, corsHeader);
  }

  // Cache the new access token
  const tokenData = {
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in * 1000),
  };
  await env.OAUTH_TOKENS.put('token_data', JSON.stringify(tokenData));

  // If Google sent a new refresh token, store it
  if (tokens.refresh_token) {
    await env.OAUTH_TOKENS.put('refresh_token', tokens.refresh_token);
  }

  return jsonResponse({
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
  }, 200, corsHeader);
}

// Logout: Remove stored tokens
async function handleLogout(request, env, corsHeader) {
  await env.OAUTH_TOKENS.delete('refresh_token');
  await env.OAUTH_TOKENS.delete('token_data');
  return jsonResponse({ success: true }, 200, corsHeader);
}

// Status: Check if authenticated
async function handleStatus(request, env, corsHeader) {
  const refreshToken = await env.OAUTH_TOKENS.get('refresh_token');
  return jsonResponse({
    authenticated: !!refreshToken
  }, 200, corsHeader);
}

// RSS Proxy: Fetch and return RSS feed (bypasses CORS)
async function handleRSS(url, corsHeader) {
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl) {
    return jsonResponse({ error: 'Missing url parameter' }, 400, corsHeader);
  }

  // Only allow specific RSS feeds for security
  const allowedFeeds = [
    'https://ccb.belgium.be/advisories.xml'
  ];

  if (!allowedFeeds.includes(feedUrl)) {
    return jsonResponse({ error: 'Feed not allowed' }, 403, corsHeader);
  }

  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'DAEMON Dashboard RSS Fetcher' }
    });

    if (!response.ok) {
      return jsonResponse({ error: `Feed returned ${response.status}` }, 502, corsHeader);
    }

    const xml = await response.text();

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Access-Control-Allow-Origin': corsHeader,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    return jsonResponse({ error: 'Failed to fetch feed' }, 502, corsHeader);
  }
}

// OTOBO: Fetch tickets for the configured user
async function handleOTRSTickets(env, corsHeader) {
  // Get credentials from environment secrets
  const username = env.OTRS_USERNAME;
  const password = env.OTRS_PASSWORD;

  if (!username || !password) {
    return jsonResponse({ error: 'OTOBO credentials not configured' }, 500, corsHeader);
  }

  try {
    // Step 1: Login to get SessionID
    const loginResponse = await fetch(`${OTOBO_BASE_URL}/Login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ UserLogin: username, Password: password }),
    });

    const loginData = await loginResponse.json();
    if (!loginData.SessionID) {
      return jsonResponse({ error: 'OTOBO login failed' }, 401, corsHeader);
    }

    const sessionId = loginData.SessionID;

    // Small delay after login for session to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 2: Search for new and open tickets owned by bert.huygens (OwnerID=3)
    const searchNew = await fetch(`${OTOBO_BASE_URL}/Search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ SessionID: sessionId, StateType: 'new', OwnerIDs: [3], Limit: 50 }),
    });
    const searchOpen = await fetch(`${OTOBO_BASE_URL}/Search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ SessionID: sessionId, StateType: 'open', OwnerIDs: [3], Limit: 50 }),
    });

    const newData = await searchNew.json();
    const openData = await searchOpen.json();

    // Check for errors in search responses
    if (newData.Error || openData.Error) {
      return jsonResponse({ error: 'OTOBO search failed' }, 500, corsHeader);
    }

    // Combine ticket IDs from both searches
    const allTicketIds = [
      ...(newData.TicketID || []),
      ...(openData.TicketID || [])
    ];

    if (allTicketIds.length === 0) {
      return jsonResponse({ tickets: [] }, 200, corsHeader);
    }

    // Step 3: Get details for each ticket sequentially to avoid rate limits
    // Include AllArticles=1 to fetch ticket body content
    const allTickets = [];
    for (const ticketId of allTicketIds) {
      const ticketResponse = await fetch(`${OTOBO_BASE_URL}/Get/${ticketId}?SessionID=${sessionId}&AllArticles=1`);
      const ticketData = await ticketResponse.json();
      if (ticketData.Ticket?.[0]) {
        allTickets.push(ticketData.Ticket[0]);
      }
    }

    // Filter by OwnerID=3 (bert.huygens)
    // Use loose equality (==) because OTOBO API may return OwnerID as string or number
    const tickets = allTickets.filter(t => t.OwnerID == 3);

    // Sort by Changed date (most recent first)
    tickets.sort((a, b) => new Date(b.Changed) - new Date(a.Changed));

    return jsonResponse({ tickets }, 200, corsHeader);
  } catch (error) {
    console.error('OTOBO error:', error);
    return jsonResponse({ error: 'Failed to fetch OTOBO tickets', details: error.message }, 502, corsHeader);
  }
}

// Helper: JSON response
function jsonResponse(data, status = 200, origin = '*') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Helper: HTML response
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html' },
  });
}

// Helper: Escape HTML to prevent XSS
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
