"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleCalendarConnection = void 0;
const googleapis_1 = require("googleapis");
const observability_1 = require("@agent/observability");
const encryption_1 = require("../security/encryption");
class GoogleCalendarConnection {
    calendar = null;
    userId;
    constructor(userId, credentials) {
        this.userId = userId;
        if (credentials) {
            // Explicit credentials (e.g., service account or passed directly)
            const auth = new googleapis_1.google.auth.JWT({
                email: credentials.client_email,
                key: credentials.private_key,
                scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
            });
            this.calendar = googleapis_1.google.calendar({ version: 'v3', auth });
        }
        else if (!userId) {
            // Fallback to default ADC if no userId and no credentials provided
            // This preserves original behavior for server-side/service-account usage if needed
            const auth = new googleapis_1.google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
            });
            this.calendar = googleapis_1.google.calendar({ version: 'v3', auth });
        }
    }
    async ensureConnection() {
        if (this.calendar)
            return;
        if (!this.userId)
            throw new Error("No userId provided and no credentials found.");
        const store = (0, observability_1.getObservabilityStore)();
        const connection = await store.getConnection(this.userId, 'google');
        if (!connection || !connection.refreshToken) {
            throw new Error(`User ${this.userId} has no Google Calendar connection or refresh token.`);
        }
        const decryptedRefreshToken = (0, encryption_1.decrypt)(connection.refreshToken);
        // Access token might be expired, but OAuth2 client handles refresh if refresh_token is present
        // We can also decrypt access token if we want to pass it
        const decryptedAccessToken = connection.accessToken ? (0, encryption_1.decrypt)(connection.accessToken) : undefined;
        const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({
            refresh_token: decryptedRefreshToken,
            access_token: decryptedAccessToken,
            // expiry_date: connection.expiresAt ? connection.expiresAt * 1000 : undefined 
        });
        this.calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    }
    async listUpcomingEvents(maxResults = 10) {
        await this.ensureConnection();
        if (!this.calendar)
            throw new Error("Failed to initialize calendar client");
        try {
            const now = new Date();
            const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            const res = await this.calendar.events.list({
                calendarId: 'primary',
                timeMin: now.toISOString(),
                timeMax: nextWeek.toISOString(),
                maxResults,
                singleEvents: true,
                orderBy: 'startTime',
            });
            if (!res.data.items) {
                return [];
            }
            return res.data.items.map((event) => ({
                id: event.id || "unknown",
                subject: event.summary || "No Subject",
                startTime: event.start?.dateTime || event.start?.date || "",
                endTime: event.end?.dateTime || event.end?.date || "",
                location: event.location || undefined,
                description: event.description || undefined,
            }));
        }
        catch (error) {
            console.error("Error fetching Google Calendar events:", error);
            throw error;
        }
    }
}
exports.GoogleCalendarConnection = GoogleCalendarConnection;
