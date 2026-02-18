"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarListEventsTool = void 0;
const googleCalendar_1 = require("../connections/googleCalendar");
exports.CalendarListEventsTool = {
    name: "calendar_list_events",
    description: "List upcoming events from the user's Google Calendar.",
    validateArgs: (args) => {
        const issues = [];
        if (args.maxResults !== undefined && typeof args.maxResults !== "number") {
            issues.push({ field: "maxResults", message: "maxResults must be a number" });
        }
        return issues;
    },
    execute: async (input) => {
        // We assume tenantId corresponds to the userId in our auth system
        // for this single-tenant/personal agent model.
        const userId = input.tenantId;
        if (!userId || userId === "default") {
            console.warn("Tools: calendar_list_events called with default/missing tenantId. Database connection might fail if no explicit credentials provided.");
        }
        const maxResults = input.args.maxResults || 10;
        // Initialize connection with the user ID context
        const connection = new googleCalendar_1.GoogleCalendarConnection(userId);
        return await connection.listUpcomingEvents(maxResults);
    },
    isAuthorized: () => true // Allow all for now, logic can be added later
};
