import { CalendarProvider } from "./calendar-provider.js";

const DUMMY_CALENDARS = [
    { id: "dummy-work", name: "Work", color: "#0ea5e9" },
    { id: "dummy-personal", name: "Personal", color: "#22c55e" },
    { id: "dummy-project", name: "Project X", color: "#f97316" },
    { id: "dummy-holidays", name: "Holidays", color: "#ef4444" }
];

function getDummyCalendars() {
    return DUMMY_CALENDARS.map((calendar) => ({ ...calendar }));
}

function resolveCalendarAllDayOnly(calendarId, options = {}) {
    const { allDayOnly = false, calendarAllDayModes = {} } = options;
    const mode = calendarAllDayModes?.[calendarId];
    if (mode === "yes") return true;
    if (mode === "no") return false;
    return allDayOnly;
}

function getDummyEventsForAnchorYear(year) {
    return [
        {
            id: `dummy-${year}-1`,
            calendarId: "dummy-work",
            title: "Design review",
            start: new Date(year, 1, 12, 9, 0, 0),
            end: new Date(year, 1, 12, 13, 30, 0),
            allDay: false
        },
        {
            id: `dummy-${year}-2`,
            calendarId: "dummy-work",
            title: "Release freeze",
            start: new Date(year, 2, 4),
            end: new Date(year, 2, 8),
            allDay: true
        },
        {
            id: `dummy-${year}-3`,
            calendarId: "dummy-personal",
            title: "Summer vacation",
            start: new Date(year, 6, 8),
            end: new Date(year, 6, 23),
            allDay: true
        },
        {
            id: `dummy-${year}-4`,
            calendarId: "dummy-project",
            title: "Project rollout window",
            start: new Date(year, 9, 3),
            end: new Date(year, 9, 29),
            allDay: true
        },
        {
            id: `dummy-${year}-5`,
            calendarId: "dummy-project",
            title: "Incident response drill",
            start: new Date(year, 10, 20, 18, 0, 0),
            end: new Date(year, 10, 21, 2, 0, 0),
            allDay: false
        },
        {
            id: `dummy-${year}-6`,
            calendarId: "dummy-personal",
            title: "Year handover",
            start: new Date(year - 1, 11, 29),
            end: new Date(year, 0, 10),
            allDay: true
        },
        {
            id: `dummy-${year}-7`,
            calendarId: "dummy-work",
            title: "Team building",
            start: new Date(year, 2, 15),
            end: new Date(year, 2, 18),
            allDay: true
        },
        {
            id: `dummy-${year}-8`,
            calendarId: "dummy-personal",
            title: "Family reunion",
            start: new Date(year, 3, 20),
            end: new Date(year, 3, 23),
            allDay: true
        },
        {
            id: `dummy-${year}-9`,
            calendarId: "dummy-project",
            title: "Beta testing",
            start: new Date(year, 4, 10),
            end: new Date(year, 4, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-10`,
            calendarId: "dummy-holidays",
            title: "Christmas break",
            start: new Date(year, 11, 24),
            end: new Date(year, 11, 27),
            allDay: true
        },
        {
            id: `dummy-${year}-11`,
            calendarId: "dummy-holidays",
            title: "New Year",
            start: new Date(year, 11, 31),
            end: new Date(year + 1, 0, 3),
            allDay: true
        },
        {
            id: `dummy-${year}-12`,
            calendarId: "dummy-work",
            title: "Quarterly planning",
            start: new Date(year, 4, 5),
            end: new Date(year, 4, 20),
            allDay: true
        },
        {
            id: `dummy-${year}-13`,
            calendarId: "dummy-work",
            title: "Client workshops",
            start: new Date(year, 6, 7),
            end: new Date(year, 6, 22),
            allDay: true
        },
        {
            id: `dummy-${year}-14`,
            calendarId: "dummy-work",
            title: "Performance reviews",
            start: new Date(year, 8, 1),
            end: new Date(year, 8, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-15`,
            calendarId: "dummy-personal",
            title: "Extended family visit",
            start: new Date(year, 4, 10),
            end: new Date(year, 4, 25),
            allDay: true
        },
        {
            id: `dummy-${year}-16`,
            calendarId: "dummy-personal",
            title: "Home renovation",
            start: new Date(year, 7, 1),
            end: new Date(year, 7, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-17`,
            calendarId: "dummy-personal",
            title: "Thanksgiving prep",
            start: new Date(year, 10, 1),
            end: new Date(year, 10, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-18`,
            calendarId: "dummy-project",
            title: "Development sprint",
            start: new Date(year, 5, 1),
            end: new Date(year, 5, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-19`,
            calendarId: "dummy-project",
            title: "User testing phase",
            start: new Date(year, 4, 15),
            end: new Date(year, 4, 30),
            allDay: true
        },
        {
            id: `dummy-${year}-20`,
            calendarId: "dummy-project",
            title: "Launch preparation",
            start: new Date(year, 9, 1),
            end: new Date(year, 9, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-21`,
            calendarId: "dummy-holidays",
            title: "Spring break",
            start: new Date(year, 3, 1),
            end: new Date(year, 3, 16),
            allDay: true
        },
        {
            id: `dummy-${year}-22`,
            calendarId: "dummy-holidays",
            title: "Memorial Day weekend",
            start: new Date(year, 4, 20),
            end: new Date(year, 5, 4),
            allDay: true
        },
        {
            id: `dummy-${year}-23`,
            calendarId: "dummy-holidays",
            title: "Thanksgiving week",
            start: new Date(year, 10, 20),
            end: new Date(year, 11, 1),
            allDay: true
        }
    ];
}

function getDummyEvents(year, options = {}) {
    const { calendarIds = [] } = options;
    const calendars = getDummyCalendars().filter((calendar) => !calendarIds.length || calendarIds.includes(calendar.id));
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    const events = [year - 1, year, year + 1]
        .flatMap((anchorYear) => getDummyEventsForAnchorYear(anchorYear))
        .filter((event) => event.start < yearEnd && event.end >= yearStart);

    return events
        .filter((event) => calendars.some((calendar) => calendar.id === event.calendarId))
        .filter((event) => !resolveCalendarAllDayOnly(event.calendarId, options) || event.allDay)
        .map((event) => {
            const calendar = calendars.find((item) => item.id === event.calendarId);
            return {
                ...event,
                calendarName: calendar?.name || "(unnamed)",
                calendarColor: calendar?.color || null
            };
        });
}

export class DummyCalendarProvider extends CalendarProvider {
    async fetchCalendars() {
        return getDummyCalendars();
    }

    async fetchCalendarEvents(year, options = {}) {
        return getDummyEvents(year, options);
    }
}