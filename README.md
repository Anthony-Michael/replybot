# ShiftSense

Work out how many hours you worked without writing anything down.

You get to the same job site most days. Some days you stay late. By the time
you remember the timesheet it's Thursday and last Monday is a guess. ShiftSense
watches where the phone actually is, learns which places are jobs, and keeps the
day-by-day log for you — including the overtime.

It's a web app you install to your home screen. No account, no server, no
uploads. Everything lives on the phone.

## What it does

- **Learns your job sites on its own.** No geofence to draw. A place you keep
  coming back to becomes a job site after six hours across two days, and the
  place you sleep is worked out from overnight presence and never counted as work.
- **Turns presence into shifts.** Arrival and departure, a lunch run off site
  deducted as an unpaid break, a coffee run that stays on the clock, a trip home
  and back split into two shifts, a night shift kept on the day it started.
- **Does the pay maths.** Daily overtime, weekly overtime, optional double time,
  configurable pay-week start and rounding — and an hour already paid as daily
  overtime is never counted a second time when the week runs past forty.
- **Tells you when it isn't sure.** If the phone went quiet for four hours the
  day says so, with the size of the doubt, instead of quietly inventing hours.
- **Never overwrites you.** Once you've confirmed or edited a day it's yours.
  When location later disagrees it offers the other number; it doesn't take it.
- **Exports a timesheet.** CSV, one row per day, decimal hours, clock times
  alongside for anyone who wants to check a disputed day.

## The one thing it can't do

**A web app cannot read location while the screen is off.** That's an operating
system rule and no amount of code gets around it. So ShiftSense does everything
it legitimately can:

- takes a fix the moment you open it, every time
- keeps a location watch running while it's on screen
- holds a wake lock through a shift, so the phone keeps reporting from a pocket
- and builds its inference to survive the holes that remain, rather than
  pretending they aren't there

In practice: open it when you get to work, leave it. Two fixes eight hours apart
at the same site are enough to reconstruct the day — it will log it and flag it
for a glance. If you want hands-off tracking with the phone locked all day, that
needs a native app; the core in `src/core/` is plain JavaScript with no browser
dependencies and would port to one directly.

## Running it

```sh
npm test          # 74 tests over the inference and pay maths
npm run serve     # http://localhost:8080
```

There's no build step and no dependencies. Geolocation needs a secure context,
which `localhost` counts as; to use it on a phone, serve it over HTTPS and add
it to the home screen.

Regenerate the icons after changing the artwork with `node scripts/make-icons.js`.

## How it works

```
GPS fixes ──▶ places ──▶ visits ──▶ shifts ──▶ day records ──▶ CSV
             (learn)   (presence)  (infer)     (yours)
```

| Module | What it owns |
| --- | --- |
| `src/core/geo.js` | Distance, centroids, rejecting vague fixes |
| `src/core/time.js` | Local days, pay weeks, clock and duration formatting |
| `src/core/places.js` | Clustering fixes into places, finding home, promoting job sites |
| `src/core/sessions.js` | Fixes → visits → shifts; breaks, split shifts, blind gaps |
| `src/core/hours.js` | Overtime, double time, rounding, weekly totals |
| `src/core/records.js` | The day log, edit precedence, suggestions, CSV |
| `src/core/store.js` | Device-local persistence, retention, backup/restore |
| `src/core/engine.js` | The refresh loop tying it together |
| `src/app/` | Geolocation tracker and the interface |

Everything under `src/core/` is pure and browser-free, which is why the awkward
cases — three fixes in a day, an eight-hour hole, a drive-by, a shift across
midnight, a retention window rolling past days already logged — are covered by
tests rather than by trying it and hoping.

### The judgement calls

Most of what makes this useful is in the defaults, all of which are in
`src/core/settings.js` and adjustable in the app:

- **Edge padding (15 min).** Last seen on site at 4:00pm, home at 4:45pm — you
  left somewhere in between. It credits the midpoint, capped at a quarter hour,
  so a long blind stretch can't invent two hours of pay.
- **Blind gaps (up to 12h, same site).** Seen at the site at seven and again at
  three with nothing between? You were there. Splitting that into two
  fifteen-minute shifts is far more wrong than joining it — so it joins it and
  marks the day for review.
- **Breaks vs. split shifts.** Off site 30 minutes or more inside a shift is an
  unpaid break; less stays paid. More than three hours away and it's a separate
  shift.
- **Home is never work.** Otherwise a long morning in the driveway becomes a
  shift.

## Privacy

Location never leaves the device. There is no account, no analytics and nothing
to sign into. Raw fixes are kept 14 days and then dropped — long enough to
re-derive a fortnight of timesheets — while the hours themselves are kept until
you delete them. "Forget location history" in Settings wipes the trail and keeps
the timesheet; "Back up" writes a JSON file you hold onto yourself.
