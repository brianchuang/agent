import { ToolExecutionInput } from "../core/contracts";
import { ToolRegistration, ToolValidationIssue } from "../core/toolRegistry";
import { GoogleCalendarConnection } from "../connections/googleCalendar";

export const CalendarListEventsTool: ToolRegistration = {
  name: "calendar_list_events",
  description: "List upcoming events from the user's Google Calendar.",
  
  validateArgs: (args: Record<string, unknown>): ToolValidationIssue[] => {
    const issues: ToolValidationIssue[] = [];
    if (args.maxResults !== undefined && typeof args.maxResults !== "number") {
      issues.push({ field: "maxResults", message: "maxResults must be a number" });
    }
    return issues;
  },

  execute: async (input: ToolExecutionInput) => {
    // We assume tenantId corresponds to the userId in our auth system
    // for this single-tenant/personal agent model.
    const userId = input.tenantId;
    
    if (!userId || userId === "default") {
        console.warn("Tools: calendar_list_events called with default/missing tenantId. Database connection might fail if no explicit credentials provided.");
    }

    const maxResults = (input.args.maxResults as number) || 10;
    
    // Initialize connection with the user ID context
    const connection = new GoogleCalendarConnection(userId);
    return await connection.listUpcomingEvents(maxResults);
  },
  
  isAuthorized: () => true // Allow all for now, logic can be added later
};
