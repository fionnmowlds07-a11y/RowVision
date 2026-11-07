# Deployment guide

**Nothing is deployed.** This is what it takes, for the owner to decide. Prices were checked on 6 November 2026, and need checking again.

## What needs hosting

The owner chose a setup with no monthly cost on 7 November 2026. **The video storage part is not built yet**, so the steps below still describe Supabase storage until the issues for it are finished.

| Part | Chosen | Cost | Notes |
|---|---|---|---|
| Web app | Vercel free, on a `.vercel.app` address | Free | Understood to be for non-commercial use only. Check Vercel's terms before charging anyone |
| Database, sign-in, queue | Supabase free, EU region | Free | Pauses after a week idle. Whether the worker's connection prevents that is untested |
| Videos | Cloudflare R2, EU location | Free up to 10 GB | Supabase's free plan caps files at 50 MB. Going over 10 GB is billed, so the app must stop uploads before that |
| Email | A separate Gmail account with an app password | Free | About 500 recipients a day. No domain needed |
| Worker | The home PC | Electricity | See `docs/home-worker.md` |

Videos are kept for 7 days. Up to 4 saved frames stay with the scores.

Supabase Pro, at about $25 a month, remains the simple upgrade. Hosted and self-hosted Supabase use the same code.

## Steps

1. Create the Supabase project in an EU region.
2. Link it, then apply the migrations: `npx supabase link`, then `npx supabase db push`.
3. Set the Auth site URL, and the email template from `supabase/templates/sign-in-code.html`.
4. Turn on the hook `hook_approved_email` under Auth Hooks, for before a user is created.
5. Set up the email sender as custom SMTP, using the Gmail account and its app password.
6. Add your own email to `approved_emails`, sign in once, then set `is_admin` to true on your profile.
7. Deploy `apps/web` with these settings. Keep the service key and secret on the server only.

   | Setting | Value |
   |---|---|
   | `SUPABASE_URL` | The project URL |
   | `SUPABASE_ANON_KEY` | The anon key |
   | `SUPABASE_SERVICE_KEY` | The service key |
   | `RETENTION_SECRET` | A long random string |

8. Schedule the 30-day deletion once a day. This step is required, as nothing else deletes old video.

   ```bash
   curl -X POST https://YOUR-APP/api/retention -H "Authorization: Bearer $RETENTION_SECRET"
   ```

9. Start the worker. See `docs/home-worker.md`.

## Check before inviting anyone

- `/api/health?deep=1` is healthy.
- An unapproved email is turned away.
- A clip goes from upload to result, and the email arrives.
- A second athlete cannot open the first one's clip.
- A test run of the deletion works on a clip with a moved date.
