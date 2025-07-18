"use client";

import * as React from "react";
import {
  addHours,
  areIntervalsOverlapping,
  differenceInMinutes,
  eachHourOfInterval,
  format,
  getHours,
  getMinutes,
  isSameDay,
  startOfDay,
} from "date-fns";
import { Temporal } from "temporal-polyfill";

import { toDate } from "@repo/temporal";

import { useCalendarSettings } from "@/atoms";
import {
  DraggableEvent,
  DroppableCell,
  EventItem,
  WeekCellsHeight,
  type CalendarEvent,
} from "@/components/event-calendar";
import { EndHour, StartHour } from "@/components/event-calendar/constants";
import { useCurrentTimeIndicator } from "@/components/event-calendar/hooks";
import type { Action } from "@/components/event-calendar/hooks/use-optimistic-events";
import { isMultiDayEvent } from "@/components/event-calendar/utils";
import { cn } from "@/lib/utils";
import { createDraftEvent } from "@/lib/utils/calendar";

interface DayViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  dispatchAction: (action: Action) => void;
}

interface PositionedEvent {
  event: CalendarEvent;
  top: number;
  height: number;
  left: number;
  width: number;
  zIndex: number;
}

interface PositionedEventProps {
  positionedEvent: PositionedEvent;
  onEventClick: (event: CalendarEvent, e: React.MouseEvent) => void;
  dispatchAction: (action: Action) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

function PositionedEvent({
  positionedEvent,
  onEventClick,
  dispatchAction,
  containerRef,
}: PositionedEventProps) {
  const [isDragging, setIsDragging] = React.useState(false);

  return (
    <div
      key={positionedEvent.event.id}
      className="absolute z-10"
      style={{
        top: `${positionedEvent.top}px`,
        height: `${positionedEvent.height}px`,
        left: `${positionedEvent.left * 100}%`,
        width: `${positionedEvent.width * 100}%`,
        zIndex: isDragging ? 9999 : positionedEvent.zIndex,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <DraggableEvent
        event={positionedEvent.event}
        view="day"
        onClick={(e) => onEventClick(positionedEvent.event, e)}
        dispatchAction={dispatchAction}
        showTime
        height={positionedEvent.height}
        containerRef={containerRef}
        setIsDragging={setIsDragging}
      />
    </div>
  );
}

export function DayView({ currentDate, events, dispatchAction }: DayViewProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const hours = React.useMemo(() => {
    const dayStart = startOfDay(currentDate);
    return eachHourOfInterval({
      start: addHours(dayStart, StartHour),
      end: addHours(dayStart, EndHour - 1),
    });
  }, [currentDate]);

  const settings = useCalendarSettings();

  const dayEvents = React.useMemo(() => {
    return events
      .filter((event) => {
        const eventStart = toDate({
          value: event.start,
          timeZone: settings.defaultTimeZone,
        });
        const eventEnd = toDate({
          value: event.end,
          timeZone: settings.defaultTimeZone,
        });
        return (
          isSameDay(currentDate, eventStart) ||
          isSameDay(currentDate, eventEnd) ||
          (currentDate > eventStart && currentDate < eventEnd)
        );
      })
      .sort(
        (a, b) =>
          toDate({
            value: a.start,
            timeZone: settings.defaultTimeZone,
          }).getTime() -
          toDate({
            value: b.start,
            timeZone: settings.defaultTimeZone,
          }).getTime(),
      );
  }, [currentDate, events, settings.defaultTimeZone]);

  // Filter all-day events
  const allDayEvents = React.useMemo(() => {
    return dayEvents.filter((event) => {
      // Include explicitly marked all-day events or multi-day events
      return event.allDay || isMultiDayEvent(event);
    });
  }, [dayEvents]);

  // Get only single-day time-based events
  const timeEvents = React.useMemo(() => {
    return dayEvents.filter((event) => {
      // Exclude all-day events and multi-day events
      return !event.allDay && !isMultiDayEvent(event);
    });
  }, [dayEvents]);

  // Process events to calculate positions
  const positionedEvents = React.useMemo(() => {
    const result: PositionedEvent[] = [];
    const dayStart = startOfDay(currentDate);

    // Sort events by start time and duration
    const sortedEvents = [...timeEvents].sort((a, b) => {
      const aStart = toDate({
        value: a.start,
        timeZone: settings.defaultTimeZone,
      });
      const bStart = toDate({
        value: b.start,
        timeZone: settings.defaultTimeZone,
      });
      const aEnd = toDate({ value: a.end, timeZone: settings.defaultTimeZone });
      const bEnd = toDate({ value: b.end, timeZone: settings.defaultTimeZone });

      // First sort by start time
      if (aStart < bStart) return -1;
      if (aStart > bStart) return 1;

      // If start times are equal, sort by duration (longer events first)
      const aDuration = differenceInMinutes(aEnd, aStart);
      const bDuration = differenceInMinutes(bEnd, bStart);
      return bDuration - aDuration;
    });

    // Track columns for overlapping events
    const columns: { event: CalendarEvent; end: Date }[][] = [];

    sortedEvents.forEach((event) => {
      const eventStart = toDate({
        value: event.start,
        timeZone: settings.defaultTimeZone,
      });
      const eventEnd = toDate({
        value: event.end,
        timeZone: settings.defaultTimeZone,
      });

      // Adjust start and end times if they're outside this day
      const adjustedStart = isSameDay(currentDate, eventStart)
        ? eventStart
        : dayStart;
      const adjustedEnd = isSameDay(currentDate, eventEnd)
        ? eventEnd
        : addHours(dayStart, 24);

      // Calculate top position and height
      const startHour =
        getHours(adjustedStart) + getMinutes(adjustedStart) / 60;
      const endHour = getHours(adjustedEnd) + getMinutes(adjustedEnd) / 60;
      const top = (startHour - StartHour) * WeekCellsHeight;
      const height = (endHour - startHour) * WeekCellsHeight;

      // Find a column for this event
      let columnIndex = 0;
      let placed = false;

      while (!placed) {
        const col = columns[columnIndex] || [];
        if (col.length === 0) {
          columns[columnIndex] = col;
          placed = true;
        } else {
          const overlaps = col.some((c) =>
            areIntervalsOverlapping(
              { start: adjustedStart, end: adjustedEnd },
              {
                start: toDate({
                  value: c.event.start,
                  timeZone: settings.defaultTimeZone,
                }),
                end: toDate({
                  value: c.event.end,
                  timeZone: settings.defaultTimeZone,
                }),
              },
            ),
          );
          if (!overlaps) {
            placed = true;
          } else {
            columnIndex++;
          }
        }
      }

      // Ensure column is initialized before pushing
      const currentColumn = columns[columnIndex] || [];
      columns[columnIndex] = currentColumn;
      currentColumn.push({ event, end: adjustedEnd });

      // First column takes full width, others are indented by 10% and take 90% width
      const width = columnIndex === 0 ? 1 : 0.9;
      const left = columnIndex === 0 ? 0 : columnIndex * 0.1;

      result.push({
        event,
        top,
        height,
        left,
        width,
        zIndex: 10 + columnIndex, // Higher columns get higher z-index
      });
    });

    return result;
  }, [currentDate, timeEvents, settings.defaultTimeZone]);

  const handleEventClick = (event: CalendarEvent, e: React.MouseEvent) => {
    e.stopPropagation();
    dispatchAction({ type: "select", event });
  };

  const showAllDaySection = allDayEvents.length > 0;
  const { currentTimePosition, currentTimeVisible } = useCurrentTimeIndicator(
    currentDate,
    "day",
  );

  const { use12Hour } = useCalendarSettings();

  return (
    <div data-slot="day-view" className="contents" ref={containerRef}>
      {showAllDaySection && (
        <div className="border-t border-border/70 bg-muted/50">
          <div className="grid grid-cols-[3rem_1fr] sm:grid-cols-[4rem_1fr]">
            <div className="relative">
              <span className="absolute bottom-0 left-0 h-6 w-16 max-w-full pe-2 text-right text-[10px] text-muted-foreground/70 sm:pe-4 sm:text-xs">
                All day
              </span>
            </div>
            <div className="relative border-r border-border/70 p-1 last:border-r-0">
              {allDayEvents.map((event) => {
                const eventStart = toDate({
                  value: event.start,
                  timeZone: settings.defaultTimeZone,
                });
                const eventEnd = toDate({
                  value: event.end,
                  timeZone: settings.defaultTimeZone,
                });
                const isFirstDay = isSameDay(currentDate, eventStart);
                const isLastDay = isSameDay(currentDate, eventEnd);

                return (
                  <EventItem
                    key={`spanning-${event.id}`}
                    onClick={(e) => handleEventClick(event, e)}
                    event={event}
                    view="month"
                    isFirstDay={isFirstDay}
                    isLastDay={isLastDay}
                  >
                    {/* Always show the title in day view for better usability */}
                    <div>{event.title}</div>
                  </EventItem>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid flex-1 grid-cols-[3rem_1fr] overflow-hidden border-t border-border/70 sm:grid-cols-[4rem_1fr]">
        <div>
          {hours.map((hour, index) => (
            <div
              key={hour.toString()}
              className="relative h-[var(--week-cells-height)] border-b border-border/70 last:border-b-0"
            >
              {index > 0 && (
                <span className="absolute -top-3 left-0 flex h-6 w-16 max-w-full items-center justify-end bg-background pe-2 text-[10px] text-muted-foreground/70 sm:pe-4 sm:text-xs">
                  {use12Hour ? format(hour, "h aaa") : format(hour, "HH:mm")}
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="relative">
          {/* Positioned events */}
          {positionedEvents.map((positionedEvent) => (
            <PositionedEvent
              key={positionedEvent.event.id}
              positionedEvent={positionedEvent}
              onEventClick={handleEventClick}
              dispatchAction={dispatchAction}
              containerRef={containerRef}
            />
          ))}

          {/* Current time indicator */}
          {currentTimeVisible && (
            <div
              className="pointer-events-none absolute right-0 left-0 z-20"
              style={{ top: `${currentTimePosition}%` }}
            >
              <div className="relative flex items-center">
                <div className="absolute -left-1 h-2 w-2 rounded-full bg-primary"></div>
                <div className="h-[2px] w-full bg-primary"></div>
              </div>
            </div>
          )}

          {/* Time grid */}
          {hours.map((hour) => {
            const hourValue = getHours(hour);
            return (
              <div
                key={hour.toString()}
                className="relative h-[var(--week-cells-height)] border-b border-border/70 last:border-b-0"
              >
                {/* Quarter-hour intervals */}
                {[0, 1, 2, 3].map((quarter) => {
                  const quarterHourTime = hourValue + quarter * 0.25;
                  return (
                    <DroppableCell
                      key={`${hour.toString()}-${quarter}`}
                      id={`day-cell-${currentDate.toISOString()}-${quarterHourTime}`}
                      date={currentDate}
                      time={quarterHourTime}
                      className={cn(
                        "absolute h-[calc(var(--week-cells-height)/4)] w-full",
                        quarter === 0 && "top-0",
                        quarter === 1 &&
                          "top-[calc(var(--week-cells-height)/4)]",
                        quarter === 2 &&
                          "top-[calc(var(--week-cells-height)/4*2)]",
                        quarter === 3 &&
                          "top-[calc(var(--week-cells-height)/4*3)]",
                      )}
                      onClick={() => {
                        const start = Temporal.ZonedDateTime.from({
                          year: currentDate.getFullYear(),
                          month: currentDate.getMonth() + 1,
                          day: currentDate.getDate(),
                          hour: hourValue,
                          minute: quarter * 15,
                          timeZone: settings.defaultTimeZone,
                        });

                        const end = start.add({ minutes: 15 });

                        dispatchAction({
                          type: "draft",
                          event: createDraftEvent({ start, end }),
                        });
                      }}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
