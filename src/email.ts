import { Resend } from "resend";
import { marked } from "marked";

function getResend(): Resend {
  const key = Bun.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set. See .env.example");
  return new Resend(key);
}

const FROM = "Carlton <onboarding@resend.dev>";

/**
 * Extract Message-ID header from a Gmail message.
 * Used for threading responses to the user's reply.
 */
export function extractMessageId(msg: any): string {
  const headers = msg.payload?.headers;
  if (!Array.isArray(headers)) return "";
  const header = headers.find((h: any) => h.name.toLowerCase() === "message-id");
  return header?.value || "";
}

export interface BriefingSentResult {
  resendId: string;
  messageId: string;
}

export async function sendBriefing(
  to: string,
  subject: string,
  markdown: string,
  date: string
): Promise<BriefingSentResult> {
  const html = await marked(markdown);
  const resend = getResend();
  const messageId = `<carlton-${date}@carlton.local>`;
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    headers: {
      "Message-ID": messageId,
    },
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return { resendId: data!.id, messageId };
}

export async function sendReply(
  to: string,
  subject: string,
  markdown: string,
  inReplyTo: string
): Promise<string> {
  const html = await marked(markdown);
  const resend = getResend();
  const headers: Record<string, string> = {};
  if (inReplyTo) {
    headers["In-Reply-To"] = inReplyTo;
    headers["References"] = inReplyTo;
  }
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    headers,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data!.id;
}
