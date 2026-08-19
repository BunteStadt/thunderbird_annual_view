import { ChevronDown, ChevronUp, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

export type CalendarListItem = {
    id: string;
    name?: string;
    color?: string | null;
};

export type CalendarListProps = {
    calendars: CalendarListItem[];
    selectedIds: Set<string>;
    allDayModes: Record<string, string>;
    minDurationHours: Record<string, number>;
    expandedIds: Set<string>;
    disabled: boolean;
    getGlobalMinDurationHours: () => number;
    onToggleCalendar: (calendar: CalendarListItem, selected: boolean) => void;
    onToggleExpanded: (calendar: CalendarListItem) => void;
    onAllDayChange: (calendar: CalendarListItem, enabled: boolean) => void;
    onDurationChange: (calendar: CalendarListItem, value: string) => void;
    onDurationStep: (calendar: CalendarListItem, delta: number) => void;
    onReset: (calendar: CalendarListItem) => void;
    onRemove: (calendar: CalendarListItem) => void;
};

export function CalendarList({
    calendars,
    selectedIds,
    allDayModes,
    minDurationHours,
    expandedIds,
    disabled,
    getGlobalMinDurationHours,
    onToggleCalendar,
    onToggleExpanded,
    onAllDayChange,
    onDurationChange,
    onDurationStep,
    onReset,
    onRemove
}: CalendarListProps) {
    return (
        <>
            {calendars.map((calendar) => {
                const calendarName = calendar.name || "(unnamed)";
                const isIcs = calendar.id.startsWith("ics-");
                const hasOverride = allDayModes[calendar.id] === "yes" || allDayModes[calendar.id] === "no"
                    || Number.isFinite(Number(minDurationHours[calendar.id]));
                const expanded = expandedIds.has(calendar.id);
                const duration = Number.isFinite(Number(minDurationHours[calendar.id]))
                    ? Number(minDurationHours[calendar.id])
                    : getGlobalMinDurationHours();

                return (
                    <article className={`calendar-row${expanded ? " is-expanded" : ""}`} key={calendar.id}>
                        <div className="calendar-row-header" onClick={(event) => {
                            if ((event.target as HTMLElement).closest("button, input, [role=\"button\"]")) return;
                            onToggleCalendar(calendar, !selectedIds.has(calendar.id));
                        }}>
                            <Checkbox
                                checked={selectedIds.has(calendar.id)}
                                onCheckedChange={(value) => onToggleCalendar(calendar, value === true)}
                                aria-label={`Show ${calendarName} in year view`}
                                data-tour="calendar-select"
                                data-calendar-control="visibility"
                            />
                            <span className="calendar-color-dot" style={{ backgroundColor: calendar.color || "var(--primary)" }} aria-hidden="true" />
                            <span className="calendar-name" title={calendarName}>{calendarName}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onToggleExpanded(calendar)}
                                aria-expanded={expanded}
                                aria-label={`${calendarName}: ${expanded ? "collapse" : "expand"} filter overrides`}
                                title={`${expanded ? "Collapse" : "Expand"} filter overrides`}
                            >
                                <span>{hasOverride ? "Custom" : "Default"}</span>
                                {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                            </Button>
                            {isIcs && (
                                <Button variant="destructive" size="icon" onClick={() => onRemove(calendar)} aria-label={`Remove calendar ${calendarName}`} title={`Remove ${calendarName}`}>
                                    <X aria-hidden="true" />
                                </Button>
                            )}
                        </div>
                        {expanded && (
                            <div className="calendar-row-details">
                                <div className="cal-chip-toggle" data-tour="specific-all-day" onClick={(event) => {
                                    if (event.target === event.currentTarget) {
                                        event.currentTarget.querySelector<HTMLElement>('[role="switch"]')?.click();
                                    }
                                }}>
                                    <Label htmlFor={`calendarAllDay-${calendar.id}`}>All-day only</Label>
                                    <Switch
                                        id={`calendarAllDay-${calendar.id}`}
                                        checked={allDayModes[calendar.id] === "yes"}
                                        disabled={disabled}
                                        onCheckedChange={(value) => onAllDayChange(calendar, value === true)}
                                        aria-label={`${calendarName}: all-day only`}
                                        data-calendar-control="all-day"
                                    />
                                </div>
                                <div className="calendar-min-length-field" data-tour="specific-duration">
                                    <Label htmlFor={`calendarDuration-${calendar.id}`}>Min length</Label>
                                    <span className="calendar-duration-control">
                                        <Button variant="outline" size="icon-sm" disabled={disabled} onClick={() => onDurationStep(calendar, -1)} aria-label={`${calendarName}: decrease minimum event length by one hour`} data-calendar-control="duration-step">-</Button>
                                        <Input
                                            id={`calendarDuration-${calendar.id}`}
                                            className="duration-hours-input"
                                            type="number"
                                            min="0"
                                            max="9999"
                                            step="1"
                                            value={String(duration)}
                                            disabled={disabled}
                                            aria-label={`${calendarName}: minimum event length in hours`}
                                            data-calendar-control="duration-input"
                                            onChange={(event) => onDurationChange(calendar, event.target.value)}
                                            onBlur={(event) => onDurationChange(calendar, event.target.value)}
                                        />
                                        <span className="duration-unit" aria-hidden="true">h</span>
                                        <Button variant="outline" size="icon-sm" disabled={disabled} onClick={() => onDurationStep(calendar, 1)} aria-label={`${calendarName}: increase minimum event length by one hour`} data-calendar-control="duration-step">+</Button>
                                    </span>
                                </div>
                                {hasOverride && (
                                    <Button variant="secondary" onClick={() => onReset(calendar)} aria-label={`${calendarName}: reset filters to default`} data-calendar-control="reset">
                                        <RotateCcw aria-hidden="true" />
                                        Reset to default
                                    </Button>
                                )}
                            </div>
                        )}
                    </article>
                );
            })}
        </>
    );
}
