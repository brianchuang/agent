"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleGmailConnection = void 0;
const googleapis_1 = require("googleapis");
const observability_1 = require("@agent/observability");
const encryption_1 = require("../security/encryption");
class GoogleGmailConnection {
    gmail;
    userId;
    constructor(userId) {
        this.userId = userId;
    }
    async ensureConnection() {
        if (this.gmail)
            return;
        if (!this.userId)
            throw new Error("No userId provided and no credentials found.");
        const store = (0, observability_1.getObservabilityStore)();
        const connection = await store.getConnection(this.userId, 'google');
        if (!connection || !connection.refreshToken) {
            throw new Error(`User ${this.userId} has no Google connection or refresh token.`);
        }
        const decryptedRefreshToken = (0, encryption_1.decrypt)(connection.refreshToken);
        const decryptedAccessToken = connection.accessToken ? (0, encryption_1.decrypt)(connection.accessToken) : undefined;
        const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({
            refresh_token: decryptedRefreshToken,
            access_token: decryptedAccessToken,
        });
        this.gmail = googleapis_1.google.gmail({ version: 'v1', auth: oauth2Client });
    }
    async listThreads(maxResults = 5) {
        await this.ensureConnection();
        const res = await this.gmail.users.threads.list({
            userId: 'me',
            maxResults,
        });
        if (!res.data.threads)
            return [];
        // Fetch details for each thread to get snippet/subject
        const threads = await Promise.all(res.data.threads.map(async (t) => {
            const details = await this.gmail.users.threads.get({
                userId: 'me',
                id: t.id,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date']
            });
            return {
                id: t.id,
                snippet: t.snippet,
                historyId: t.historyId,
                messages: details.data.messages
            };
        }));
        return threads;
    }
    async getThread(threadId) {
        await this.ensureConnection();
        const res = await this.gmail.users.threads.get({
            userId: 'me',
            id: threadId,
        });
        return res.data;
    }
    async createDraft(to, subject, body) {
        await this.ensureConnection();
        const message = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            `MIME-Version: 1.0`,
            ``,
            body
        ].join('\n');
        // Base64url encode
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const res = await this.gmail.users.drafts.create({
            userId: 'me',
            requestBody: {
                message: {
                    raw: encodedMessage
                }
            }
        });
        return res.data;
    }
    async sendEmail(to, subject, body) {
        await this.ensureConnection();
        const message = [
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            `MIME-Version: 1.0`,
            ``,
            body
        ].join('\n');
        const encodedMessage = Buffer.from(message)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
        const res = await this.gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
        return res.data;
    }
}
exports.GoogleGmailConnection = GoogleGmailConnection;
