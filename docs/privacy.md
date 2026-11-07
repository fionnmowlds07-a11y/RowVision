# What RowVision stores

This is a plain record of what the preview does. It is not a legal document, and a legal review is needed before any public launch or any under-18 joins.

## Who it is for

An invite-only preview for adults the owner knows personally. Only emails on the approved list can sign in, and no date of birth is collected. Testers are told in person that clips may be used for training, that the admin can open their clips, about the 30-day deletion, and to upload adult crews only. There is no notice in the app, so there is no record of what was said.

## What is stored

| What | Where | How long |
|---|---|---|
| Email, name, chosen colours, last setup | Database | Until the account is deleted |
| The uploaded video | Storage | Until the working copy exists, usually minutes |
| The working copy, up to 60 seconds | Storage | 30 days |
| Joint positions and angles for each frame | Storage | 30 days |
| Scores, rating and summary numbers | Database | Until the clip or account is deleted |
| Clips kept for training | Private store | Until the owner stops keeping them, or the account or clip is deleted |
| Reports from Something wrong? | Database | Until the clip or account is deleted |
| The admin's access log | Database | Kept, as a record of who opened what |

Joint positions are never stored in the kept summary, and a test checks this. Clips kept for training are chosen by hand on the admin page. A model already trained on a clip cannot be untrained.

## Who can see it

- Athletes see only their own clips, enforced in the database and tested.
- The admin can open any clip and result. Each one opened is logged.
- As the database owner, the admin can also reach data directly, outside the app.
- The worker sees each clip while it is analysed, and keeps nothing afterwards, even after a failure.

Emails carry a link only, with no footage or scores. Everything is private, and video is reached through signed links that expire after an hour.

## Deleting

Athletes can delete any clip or their whole account at any time, and this removes the files too. Removing an email from the approved list stops that person signing in, but it does not delete their data.

The 30-day deletion runs from the web host on a schedule, so it does not depend on the worker's computer. If the schedule stops, deletion stops, so it needs watching.

## Before under-18s

The issues in the "Before juniors" milestone must be done first. Rowing Ireland's filming policy asks that parents and juniors both consent, which goes further than the digital consent age of 16. Talk to the club's safeguarding lead first. Footage from adults can still show juniors and other crews.
