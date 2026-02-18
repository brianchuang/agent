import { gmail_v1 } from "googleapis";
export declare class GoogleGmailConnection {
    private gmail;
    private userId;
    constructor(userId: string);
    private ensureConnection;
    listThreads(maxResults?: number): Promise<{
        id: string | null | undefined;
        snippet: string | null | undefined;
        historyId: string | null | undefined;
        messages: gmail_v1.Schema$Message[] | undefined;
    }[]>;
    getThread(threadId: string): Promise<gmail_v1.Schema$Thread>;
    createDraft(to: string, subject: string, body: string): Promise<gmail_v1.Schema$Draft>;
    sendEmail(to: string, subject: string, body: string): Promise<gmail_v1.Schema$Message>;
}
