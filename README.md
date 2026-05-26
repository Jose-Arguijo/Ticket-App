# Dispatch Papers

A no-dependency Node website for trucking paperwork submission with business-scoped role access.

## Run

```bash
npm start
```

Open `http://localhost:4173`.

Run the production smoke checks with:

```bash
npm test
```

If you have a MongoDB URI configured, seed the database with:

```bash
npm run init:mongo
```

## Demo Accounts

- Admin: `admin@tickets.local` / `admin123`
- Manager: `manager@demohauling.com` / `manager123`
- Employee: `driver@demohauling.com` / `driver123`

## Role Rules

- Admins create businesses and manager accounts.
- Managers can only see employees and files inside their assigned business.
- Managers can flag files for employee review, but they cannot edit employee sheet contents.
- Employees can only see, create, edit, submit, and export their own files.
- Employees can delete drafts, but submitted files cannot be deleted.
- File API routes enforce scope on the server before returning file rows or downloads.
- `/api/health` is available for deployment health checks.

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Render, Vercel, MongoDB Atlas, and Cloudinary guidance.
