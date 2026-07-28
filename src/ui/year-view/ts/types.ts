export type ThemeMode = "auto" | "light" | "dark";

export type ViewMode = "linear" | "day-aligned" | "week-rows" | "two-week-rows" | "one-week-rows";

export type CalendarAllDayMode = "yes" | "no" | "follow";

export interface CalendarInfo {
  id: string;
  name: string;
  color: string | null;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  isAllDay?: boolean;
  description?: string;
  location?: string;
  calendarName?: string;
  calendarColor?: string | null;
  color?: string;
}

export interface FilterStats {
  filteredOut: number;
  total: number;
}

export interface CalendarFilters {
  calendarIds: string[];
  allDayOnly: boolean;
  calendarAllDayModes: Record<string, CalendarAllDayMode>;
  getMinDurationMs: (calendarId: string) => number;
}

export interface RefreshSettings {
  autoRefreshEnabled: boolean;
  autoRefreshInterval: number;
}
