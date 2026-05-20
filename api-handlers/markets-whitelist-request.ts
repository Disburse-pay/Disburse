import { assertMethod, readJson, sendError, sendJson, type ApiRequest, type ApiResponse } from "../server/http.js";
import { Resend } from "resend";

/**
 * POST /api/markets-whitelist-request
 * 
 * Body: { name, email, twitter }
 * Sends an email to notify@disburse.online with the user's request.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  try {
    assertMethod(request, "POST");
    
    const body = await readJson(request);
    const { name, email, twitter } = body;
    
    if (!name || !email) {
      sendJson(response, 400, { error: "Name and email are required" });
      return;
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error("Missing RESEND_API_KEY environment variable");
      sendJson(response, 500, { error: "Email service is not configured" });
      return;
    }

    const resend = new Resend(resendApiKey);

    const emailContent = `
      <h2>New Whitelist Request for Disburse Markets</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Twitter/X:</strong> ${twitter || "Not provided"}</p>
    `;

    // Note: The sender ('from' address) must be a verified domain in your Resend account, 
    // or you can use the default testing domain provided by Resend (onboarding@resend.dev).
    // Using onboarding@resend.dev only allows sending to the email registered to your Resend account.
    // If notify@disburse.online is your verified domain, you can send from something like no-reply@disburse.online.
    const { data, error } = await resend.emails.send({
      from: "Disburse <notify@disburse.online>", // Make sure to verify this domain in Resend
      to: ["notify@disburse.online"],
      subject: "New Whitelist Request",
      html: emailContent,
    });

    if (error) {
      console.error("Resend error:", error);
      sendJson(response, 500, { error: "Failed to send email request" });
      return;
    }

    sendJson(response, 200, { success: true, message: "Request sent successfully" });
  } catch (error) {
    sendError(response, error);
  }
}
