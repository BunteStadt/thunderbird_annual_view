default:
	@just --list --unsorted

# Kopiert die Experiment-APIs aus dem Submodule nach experiments/ für die Entwicklung
sync-experiments:
	mkdir -p experiments/calendar
	cp -R submodules/calendar/experiments/calendar/* experiments/calendar/

# Baut das XPI-Paket für den Release
build-xpi:
	mkdir -p dist/package
	cp -R manifest.json src experiments icons dist/package/
	cd dist/package && zip -r ../calendar-annual-view.xpi manifest.json src icons experiments
