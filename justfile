default:
	@just --list --unsorted

# Creates a tag from the manifest.json version and pushes it to origin.
# Only runs on the main branch when it is in sync with origin/main.
tag:
	pwsh -NoProfile assets/scripts/tag-release.ps1

# Start Thunderbird with the addon-test profile.
tb:
	thunderbird -P addon-test --no-remote

# Build and start the SaaS website with Wrangler.
website:
	npm run dev:saas:full
