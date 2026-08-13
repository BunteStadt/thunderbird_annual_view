default:
	@just --list --unsorted

# Builds the XPI and assembled package for release
build-xpi:
	npm run build:xpi
# Build the XPI and run the Thunderbird web extension linter
lint-thunderbird:
	npm run lint:thunderbird
# Creates a tag from the manifest.json version and pushes it to origin
# Only runs on the main branch when it is in sync with origin/main.
tag:
	pwsh -NoProfile assets/scripts/tag-release.ps1

# start Thunderbird with addon-test profile
tb:
	thunderbird -P addon-test --no-remote

# build and start the SaaS website with Wrangler
website:
	npm run dev:saas:full

#build website with vite and start it
vweb:
	npm run dev:saas
