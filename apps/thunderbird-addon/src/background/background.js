// Keep the annual view easy to reach by reusing a single tab.
const yearViewUrl = browser.runtime.getURL("apps/thunderbird-addon/src/ui/year-view/year-view.html");

browser.action.onClicked.addListener(() => {
    createCustomSpace().catch(console.error);
});


async function createCustomSpace() {

    if (await openIfSpaceExists()) {
        return;
    }

    const space = await browser.spaces.create(
        "Annual_View",                  // unique name
        { url: yearViewUrl },// tabProperties
        {

            "defaultIcons": {
                "16": "apps/thunderbird-addon/icons/annual_view_prefers-color.svg",
                "32": "apps/thunderbird-addon/icons/annual_view_prefers-color.svg"
            }
        }

    );

    await openIfSpaceExists();
    console.log("Custom space created:", space);
}


async function openIfSpaceExists() {
    const spaces = await browser.spaces.query({
        isSelfOwned: true,
        name: "Annual_View"
    });

    if (spaces.length > 0) {
        // Space exists → open/focus it
        await browser.spaces.open(spaces[0].id);
        console.log("Opened existing Annual_View space");
        return true;
    }
    console.log("No existing Annual_View space found");
    return false;
}