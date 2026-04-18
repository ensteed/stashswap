import { config } from "../config.js";
import { Resend, type CreateEmailResponse } from "resend";

const resend = new Resend(config.resend.api_key);

export interface email_body {
    to: string | string[];
    from: string;
    subject: string;
    html: string;
    cc?: string | string[];
    scheduledAt?: string;
}

function to_resend_payload(email: email_body) {
    return {
        to: email.to,
        from: email.from,
        subject: email.subject,
        html: email.html,
        ...(email.cc !== undefined ? { cc: email.cc } : {}),
        ...(email.scheduledAt !== undefined ? { scheduledAt: email.scheduledAt } : {}),
    };
}

export type email_response = {
    id: string | null;
    error: string | null;
};

export type email_callback = (resp: email_response) => void;

export function send_email(email: email_body, callback: email_callback) {
    const on_send_resolved = (resp: CreateEmailResponse) => {
        const er: email_response = {
            id: resp.data ? resp.data.id : null,
            error: resp.error ? resp.error.message : null,
        };
        callback(er);
        console.log("Email send result: ", er);
    };
    const on_send_rejected = (err: any) => {
        const er: email_response = {
            id: null,
            error: "Failed to send email: " + err.message,
        };
        callback(er);
        console.error("Error sending email: ", er);
    };
    resend.emails.send(to_resend_payload(email)).then(on_send_resolved, on_send_rejected);
}
