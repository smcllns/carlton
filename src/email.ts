import { Resend } from "resend";
import { marked } from "marked";

function getResend(): Resend {
  const key = Bun.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set. See .env.example");
  return new Resend(key);
}

const FROM = "Carlton <onboarding@resend.dev>";

export function briefingMessageId(date: string): string {
  return `<carlton-${date}@carlton.local>`;
}

export async function sendBriefing(
  to: string,
  subject: string,
  markdown: string,
  date: string,
): Promise<{ resendId: string; messageId: string }> {
  const html = await marked(markdown);
  const resend = getResend();
  const messageId = briefingMessageId(date);
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
  inReplyTo: string,
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
