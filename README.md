# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## Meta business integration

Admin settings include a Meta connector for Facebook Pages, Instagram business accounts, ad accounts, and product catalogs. Configure these Supabase Edge Function secrets before using it:

- `META_APP_ID`
- `META_APP_SECRET`
- `META_REDIRECT_URI` set to `https://YOUR-DOMAIN/admin/meta-callback`
- Optional: `META_GRAPH_VERSION` (defaults to `v25.0`)
- `SITE_URL` or `PUBLIC_SITE_URL` for catalog product URLs

The Meta app should request the permissions needed for the selected workflows: `business_management`, `catalog_management`, `ads_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`, and `instagram_basic`. Catalog sync lands raw Meta responses in `landing_raw_meta` before updating channel state.

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)

## Competitions Engine Blueprint

A technical blueprint for a Gmail-first competitions workflow engine is available at:

- `docs/competitions-engine-blueprint.md`

This blueprint covers ingestion, classification, extraction, tasking, alerting, and phased automation.
