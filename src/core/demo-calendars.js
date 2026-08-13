import holidaysCalendar from "../../assets/demo_calendar/holidays-calendar.ics?raw";
import personalCalendar from "../../assets/demo_calendar/personal-calendar.ics?raw";
import projectCalendar from "../../assets/demo_calendar/project-calendar.ics?raw";
import workCalendar from "../../assets/demo_calendar/work-calendar.ics?raw";

export const demoCalendars = [
    { id: "ics-demo-holidays", name: "Holidays", color: "#d66b5d", content: holidaysCalendar },
    { id: "ics-demo-personal", name: "Personal", color: "#4c8d80", content: personalCalendar },
    { id: "ics-demo-project", name: "Project", color: "#c3914a", content: projectCalendar },
    { id: "ics-demo-work", name: "Work", color: "#5b77a8", content: workCalendar }
];
