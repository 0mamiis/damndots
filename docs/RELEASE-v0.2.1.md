# damndots v0.2.1

Model discovery now follows changes in the configured provider instead of keeping the first fetched list indefinitely.

- Settings and model pickers refresh every 30 seconds while visible, and on focus.
- Backend provider and model reads refresh stale catalogs, with concurrent discovery requests shared per provider.
- Provider outages retain the last successful catalog, expose the discovery error in settings, and throttle automatic retries.
- Manual model entries survive refresh. Changing a provider URL or key invalidates the discovery age.
- Refresh requests finishing after a provider is removed or changed cannot restore the old configuration.

Validation: provider discovery regression tests, workspace tests and typechecks, dashboard production build, and release source checks.
