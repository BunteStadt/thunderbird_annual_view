default:
	@just --list --unsorted

# Builds the XPI and assembled package for release
build-xpi:
	assets/scripts/build-xpi.sh
# Creates a tag from the manifest.json version and pushes it to origin
# Only runs on the main branch when it is in sync with origin/main.
tag:
	pwsh -NoProfile assets/scripts/tag-release.ps1

# start Thunderbird with addon-test profile
tb:
	thunderbird -P addon-test --no-remote