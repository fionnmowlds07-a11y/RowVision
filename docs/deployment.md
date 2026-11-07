# Deployment guide

**Nothing is deployed.** This is what it takes, for the owner to decide. Prices were checked on 6 November 2026, and need checking again.

## What needs hosting

| Part | Recommended | Rough cost | Why |
|---|---|---|---|
| Database, sign-in, storage | Supabase Pro, EU region | About $25 a month | The free plan caps files at 50 MB, and clips reach about 150 MB. It also pauses after a week idle |
| Web app | Vercel Hobby, or a small server | Free | Vercel's free plan is for non-commercial use only. Check that its functions can run in the EU |
| Email | Resend free tier | Free | 3,000 emails a month and 100 a day. Supabase's built-in email only reaches your own team |
| Domain | Any | About €10 to €15 a year | Needed to send email |
| Worker | The home PC | Electricity | See `docs/home-worker.md` |

Hosted and self-hosted Supabase use the same code, so this can change later without a rebuild.

## Steps

1. Create the Supabase project in an EU region.
2. Link it, then apply the migrations: `npx supabase link`, then `npx supabase db push`.
3. Set the Auth site URL, and the email template from `supabase/templates/sign-in-code.html`.
4. Turn on the hook `hook_approved_email` under Auth Hooks, for before a user is created.
5. Set up the email sender as custom SMTP, with a verified domain.
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
