default:
	@just --list --unsorted

# Copies experiment APIs from the submodule to experiments/ for development
sync-experiments:
	mkdir -p apps/thunderbird-addon/experiments/calendar
	cp -R submodules/calendar/experiments/calendar/* apps/thunderbird-addon/experiments/calendar/

# Builds the XPI package for release
build-xpi:
	mkdir -p dist/package
	cp -R manifest.json apps packages dist/package/
	cd dist/package && zip -r ../calendar-annual-view.xpi manifest.json apps packages
# Creates a tag from the manifest.json version and pushes it to origin
# Only runs on the main branch when it is in sync with origin/main.
tag:
	pwsh -NoProfile scripts/tag-release.ps1