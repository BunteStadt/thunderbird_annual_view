// Keep the year view easy to reach by reusing a single tab.
const yearViewUrl = browser.runtime.getURL("index.html");

browser.action.onClicked.addListener(() => {
    createCustomSpace().catch(console.error);
});

// Open the Year View automatically whenever Thunderbird starts or the
// extension is freshly installed, so the calendar is visible right away.
browser.runtime.onInstalled.addListener(() => {
    createCustomSpace().catch(console.error);
});

browser.runtime.onStartup.addListener(() => {
    createCustomSpace().catch(console.error);
});


async function createCustomSpace() {

    if (await openIfSpaceExists()) {
        return;
    }

    const space = await browser.spaces.create(
        "Year_View",                  // unique name
        { url: yearViewUrl },// tabProperties
        {

            "defaultIcons": {
                "16": "assets/icons/Yearview_logo.svg",
                "32": "assets/icons/Yearview_logo.svg"
            }
        }

    );

    await openIfSpaceExists();
    console.log("Custom space created:", space);
}


async function openIfSpaceExists() {
    const spaces = await browser.spaces.query({ isSelfOwned: true, name: "Year_View" });

    if (spaces.length === 0) {
        const legacySpaces = await browser.spaces.query({ isSelfOwned: true, name: "Annual_View" });
        if (legacySpaces.length > 0) {
            await browser.spaces.open(legacySpaces[0].id);
            console.log("Opened existing legacy Annual_View space");
            return true;
        }
    }

    if (spaces.length > 0) {
        // Space exists → open/focus it
        await browser.spaces.open(spaces[0].id);
        console.log("Opened existing Year_View space");
        return true;
    }
    console.log("No existing Year_View space found");
    return false;
}