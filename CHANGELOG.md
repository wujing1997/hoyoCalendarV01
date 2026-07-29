# Changelog

## 3.0.0 - 2026-07-30

### New

- Rebuilt the interface as a focused productivity workspace with day, week and
  month views.
- Added responsive wide, compact and minimum-size layouts.
- Added local natural-language parsing for common dates, times, durations,
  recurring tasks and deadlines.
- Added searchable task details, calendar filters, theme switching, timers and
  saved window preferences.

### Changed

- Moved all event writes into one atomic local `EventStore`.
- Changed the Python service into a planning-only Agent that returns actions for
  the local store to apply.
- Reduced Agent latency with intent-based tool selection, bounded history and a
  maximum of three tool rounds.
- Made AI optional: core calendar workflows continue to work when the Agent is
  unavailable or unconfigured.
- Replaced raw connection errors with clear in-app status messages.

### Fixed

- Deadline completion now moves the task into the completion section instead of
  making it vanish immediately.
- Clicking a completed Deadline again restores it to the active schedule.
- A completed Deadline no longer appears on later dates.
- Ordinary recurring tasks still complete independently for each date.
- Window state is saved reliably during application shutdown.

## 2.3.0

- Introduced Deadline tasks and daily remaining-day labels.
- Added initial AI creation support for deadline expressions.
