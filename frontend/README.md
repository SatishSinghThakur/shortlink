# tiny-link frontend

An Angular interface for the existing Shortlink API. No additional runtime dependencies are required for the UI improvements.

## Run locally

```powershell
npm install
npm start
```

Open `http://localhost:4200`. Start the Spring Boot backend from `../backend` on port 8080; `proxy.conf.json` forwards `/api` requests to it. Redis and backend configuration are described in the project-level `docker-compose.yml`. Do not assume that development Compose configuration is ready for a public deployment: see [the public readiness review](../PUBLIC_READINESS.md).

```powershell
npm run build
npm test -- --watch=false
```

The production build is written to `dist/frontend`. Production hosting must forward `/api/` to the backend; `nginx.conf` provides that route. The backend must return short URLs using the actual public HTTPS origin.

## UI features

- Destination and alias previews, inline validation, optional custom aliases, and expiry presets (one day, seven days, or thirty days).
- Copy feedback and native sharing on supported devices. Clipboard failure gives manual-copy guidance.
- Light/dark appearance, keyboard focus states, responsive layout, reduced-motion support, and accessible loading/error states.
- Recent links with search, newest/oldest sorting, CSV export, and removal from the local list. Removing an item does not delete its server-side link.
- History stays in memory by default. Enabling **Remember on this browser** saves up to 30 recent links locally; disabling it removes the saved history while retaining the current session's list. This is device-specific convenience, not an account or backup. Saved records are validated before display.
- Analytics lookup accepts a code or a complete short URL. The chart displays the last seven calendar days or clicks grouped by hour across all recorded dates, with real counts and explicit empty states.
- Optional 30-second refresh pauses while the tab is hidden, avoids overlapping requests, and turns off on errors. Switching links cancels stale requests. Requests time out after 15 seconds.

## API contract and limits

Creation uses `POST /api/shorten`; stats and charts use `GET /api/stats/{code}` and `GET /api/analytics/{code}`. The UI sends no deletion requests and displays no creator or visitor IP addresses. The current API still exposes private information and lacks ownership checks; the backend must address this before public use.

The existing backend uses timestamps without a timezone (`LocalDateTime`). The UI preserves that contract. Expiry and day/hour buckets require the service's configured timezone to agree with the intended time; UTC/offset-aware timestamps must be introduced on both sides for reliable use across timezones. Client validation improves feedback, but must also be enforced by the API.

Native sharing is progressively enabled using the [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share). Clipboard copying uses [`writeText`](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText), which requires a secure context such as HTTPS or localhost. The UI handles unavailable or denied clipboard access without reporting a false success.
