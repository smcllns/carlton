import { Resend } from "resend";
import { marked } from "marked";

function getResend(): Resend {
  const key = Bun.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set. See .env.example");
  return new Resend(key);
}

const FROM = "Carlton <onboarding@resend.dev>";

export async function sendBriefing(
  to: string,
  subject: string,
  markdown: string
): Promise<string> {
  const html = await marked(markdown);
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data!.id;
}

export async function sendReply(
  to: string,
  subject: string,
  markdown: string,
  inReplyTo: string
): Promise<string> {
  const html = await marked(markdown);
  const resend = getResend();
  const { data, error } = await resend.emails.send({
    from: FROM,
    to,
    subject,
    html,
    headers: {
      "In-Reply-To": inReplyTo,
      References: inReplyTo,
    },
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data!.id;
}
