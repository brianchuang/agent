export interface CalendarEvent {
    id: string;
    subject: string;
    startTime: string;
    endTime: string;
    location?: string;
    description?: string;
}
export declare class GoogleCalendarConnection {
    private calendar;
    private userId;
    constructor(userId?: string, credentials?: any);
    private ensureConnection;
    listUpcomingEvents(maxResults?: number): Promise<CalendarEvent[]>;
}
