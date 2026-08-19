import holidaysCalendar from "../../assets/demo_calendar/holidays-calendar.ics?raw";
import personalCalendar from "../../assets/demo_calendar/personal-calendar.ics?raw";
import projectCalendar from "../../assets/demo_calendar/project-calendar.ics?raw";
import workCalendar from "../../assets/demo_calendar/work-calendar.ics?raw";

export const demoCalendars = [
    { id: "ics-demo-holidays", name: "Holidays", color: "#ef4444", content: holidaysCalendar },
    { id: "ics-demo-personal", name: "Personal", color: "#22c55e", content: personalCalendar },
    { id: "ics-demo-project", name: "Project", color: "#f97316", content: projectCalendar },
    { id: "ics-demo-work", name: "Work", color: "#0ea5e9", content: workCalendar }
];
