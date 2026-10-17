# Foxprey beta signup Worker

Deploy `index.mjs` as the entry point for the existing Cloudflare Worker **website-api**.
In Cloudflare: Workers & Pages → website-api → Edit code. Replace the starter code
with the contents of `index.mjs`, then Deploy. The existing encrypted secrets must be:

- `GOOGLE_SERVICE_ACCOUNT_JSON`: the complete service account JSON key
- `TURNSTILE_SECRET_KEY`: the secret paired with the site's public Turnstile key

Never commit either secret. The service account must have Editor access to the
spreadsheet, and the Google Sheets API must be enabled in its Google project.

The handler accepts POST `/beta-signup` from `https://foxprey.com` and verifies
Turnstile hostname `foxprey.com` and action `beta_signup`. It appends an ISO UTC
timestamp, name, and email to the `List` tab (columns Added, Name, Email).
Values are written as RAW text. No email is sent by this handler.

The browser form uses `signup.js`. Its production Turnstile key is intentionally
restricted to foxprey.com, so localhost can preview the layout but cannot complete
a real signup. Deploy the Worker before publishing the form. Then submit one
controlled signup on foxprey.com and verify all three columns in the sheet.
The endpoint root `/` returns 404 intentionally.

Local backend checks (mocked services, no real sheet writes):

    node --test worker/index.test.mjs

Repeated signups can create duplicate rows. Network failures after an append can
leave a saved row even when the browser cannot confirm success. The handler does
not automatically retry writes. Turnstile and a honeypot deter bots; they are not
a substitute for monitoring abuse or adding rate limits if needed.
