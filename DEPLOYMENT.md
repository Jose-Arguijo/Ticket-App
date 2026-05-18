# Deployment Setup

This app now supports two deployment styles:

- **Render web service**: simplest production path because the whole app runs as one Node service.
- **Vercel static + API functions**: supported through `api/[...path].js`, useful if you prefer Vercel previews.

Use **MongoDB Atlas** for deployed data. The local `data/db.json` fallback is only for local development.

## Required Environment Variables

Set these on Render or Vercel:

```bash
NODE_ENV=production
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster-host>/ticket_app?retryWrites=true&w=majority
MONGODB_DB=ticket_app
```

Optional:

```bash
MONGODB_COLLECTION=app_state
ALLOWED_ORIGINS=https://your-frontend-domain.com
COOKIE_SAMESITE=Lax
COOKIE_SECURE=true
```

Keep `COOKIE_SAMESITE=Lax` for same-origin deployments. Only use `COOKIE_SAMESITE=None` when your frontend and API are on different sites, and pair it with `COOKIE_SECURE=true`.

## MongoDB Atlas

1. Create a MongoDB Atlas project.
2. Create a cluster. For Render, pick a MongoDB region close to your Render region.
3. Create a database user with a strong password.
4. Open **Network Access**.
5. For Render, allowlist the Render service outbound IPs after the service exists.
6. For Vercel serverless deployments, you may need Atlas access from anywhere (`0.0.0.0/0`) unless you use a setup with stable egress. Use a strong database user and least-privilege permissions.
7. Copy the Node.js connection string and set it as `MONGODB_URI`.

## Render

The repo includes `render.yaml`, so Render can create the service from the blueprint.

Dashboard setup:

1. Push this repo to GitHub.
2. In Render, choose **New > Blueprint** or **New > Web Service**.
3. Connect the GitHub repo.
4. Use:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Node version: `22`
5. Add environment variables:
   - `NODE_ENV=production`
   - `MONGODB_URI=<your Atlas URI>`
   - `MONGODB_DB=ticket_app`
6. Deploy.

Render will provide an `onrender.com` URL. If you use Render for the whole app, no CORS or cross-site cookie setup is needed.

## Vercel

This repo includes `api/[...path].js`, so Vercel can deploy `/api/*` as Node functions and serve the static files from `public/`.

Dashboard setup:

1. Push this repo to GitHub.
2. In Vercel, create a new project from the repo.
3. Framework preset: `Other`.
4. Build command: leave empty.
5. Output directory: leave empty.
6. Add environment variables for Production and Preview:
   - `NODE_ENV=production`
   - `MONGODB_URI=<your Atlas URI>`
   - `MONGODB_DB=ticket_app`
7. Deploy.

CLI setup:

```bash
vercel login
vercel link
vercel env add MONGODB_URI production preview development
vercel env add MONGODB_DB production preview development
vercel --prod
```

## Should You Use Cloudinary?

Not yet for the current app. The current workflow stores typed ticket rows and generates Excel downloads, so MongoDB is enough.

Cloudinary becomes useful if drivers need to upload:

- photos of paper tickets
- scanned PDFs
- delivery receipts
- damage/load images
- large attachments that should not live in MongoDB

If you add uploads, store the file itself in Cloudinary and store only metadata in MongoDB:

```json
{
  "businessId": "biz_...",
  "employeeId": "usr_...",
  "fileId": "file_...",
  "cloudinaryPublicId": "tickets/biz_x/file_y/photo_z",
  "secureUrl": "https://res.cloudinary.com/..."
}
```

For production, prefer signed/backend uploads so your Cloudinary API secret stays server-side. Keep the existing role checks in the app as the source of truth for who can see each attachment.
