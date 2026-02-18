import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { ingestSlackThreadReply } from "@/lib/dashboard-service";

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  event_id?: string;
  event_time?: number;
  team_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    user?: string;
    text?: string;
    channel?: string;
    ts?: string;
    thread_ts?: string;
    bot_id?: string;
  };
};

function parseSlackEnvelope(rawBody: string): SlackEnvelope {
  try {
    return (JSON.parse(rawBody) as SlackEnvelope) ?? {};
  } catch {
    const form = new URLSearchParams(rawBody);
    const payload = form.get("payload");
    if (payload) {
      try {
        return (JSON.parse(payload) as SlackEnvelope) ?? {};
      } catch {
        return {};
      }
    }
    return {
      type: form.get("type") ?? undefined,
      challenge: form.get("challenge") ?? undefined
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function verifySlackSignature(request: Request, rawBody: string): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    return false;
  }

  const ts = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");
  if (!ts || !signature) {
    return false;
  }

  const timestamp = Number.parseInt(ts, 10);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > 300) {
    return false;
  }

  const base = `v0:${ts}:${rawBody}`;
  const digest = crypto.createHmac("sha256", signingSecret).update(base).digest("hex");
  const computed = `v0=${digest}`;
  return safeEqual(computed, signature);
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-slack-signature");
  const ts = request.headers.get("x-slack-request-timestamp");
  const allowUnsignedInDev = process.env.NODE_ENV !== "production";
  const body = parseSlackEnvelope(rawBody);
  console.log(
    JSON.stringify({
      component: "slack-events",
      event: "request_received",
      type: body.type ?? null,
      hasSignature: Boolean(signature),
      hasTimestamp: Boolean(ts),
      hasSigningSecret: Boolean(process.env.SLACK_SIGNING_SECRET?.trim())
    })
  );
  if (body.type === "url_verification" && typeof body.challenge === "string") {
    // In local development, allow URL verification before signature checks to simplify tunnel setup.
    if (process.env.NODE_ENV !== "production") {
      return new Response(body.challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
    }
    if (!verifySlackSignature(request, rawBody) && !allowUnsignedInDev) {
      console.warn(
        JSON.stringify({
          component: "slack-events",
          event: "challenge_signature_invalid"
        })
      );
      return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
    }
    return new Response(body.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  if (!verifySlackSignature(request, rawBody) && !allowUnsignedInDev) {
    console.warn(
      JSON.stringify({
        component: "slack-events",
        event: "event_signature_invalid",
        type: body.type ?? null
      })
    );
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }
  if (!verifySlackSignature(request, rawBody) && allowUnsignedInDev) {
    console.warn(
      JSON.stringify({
        component: "slack-events",
        event: "event_signature_bypassed_dev",
        type: body.type ?? null
      })
    );
  }

  if (body.type !== "event_callback") {
    return NextResponse.json({ ok: true });
  }

  const event = body.event;
  if (!event || event.type !== "message" || event.subtype || event.bot_id) {
    return NextResponse.json({ ok: true });
  }

  if (
    typeof body.event_id !== "string" ||
    typeof body.team_id !== "string" ||
    typeof event.channel !== "string" ||
    typeof event.user !== "string" ||
    typeof event.ts !== "string" ||
    typeof event.text !== "string"
  ) {
    return NextResponse.json({ ok: true });
  }

  const threadId = typeof event.thread_ts === "string" && event.thread_ts.trim().length > 0
    ? event.thread_ts
    : event.ts;

  await ingestSlackThreadReply({
    providerTeamId: body.team_id,
    eventId: body.event_id,
    eventTs: String(body.event_time ?? Date.now() / 1000),
    channelId: event.channel,
    threadId,
    messageId: event.ts,
    userId: event.user,
    message: event.text
  });

  return NextResponse.json({ ok: true });
}
