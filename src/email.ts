import { Resend } from "resend";
import { marked } from "marked";

function getResend(): Resend {
  const key = Bun.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY not set. See .env.example");
  return new Resend(key);
}

const FROM = "Carlton <onboarding@resend.dev>";

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

