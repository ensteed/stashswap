import { Router, type Request, type Response } from "express";
import { MongoClient, ObjectId, type Collection } from "mongodb";
import Stripe from "stripe";

import { config } from "../config.js";
import { render_fragment } from "../template.js";
import { verify_liuser, type liuser_payload } from "./auth.js";
import { ensure_seller_account, create_connect_onboarding_link } from "../api/stripe.js";
import type { ss_user, ss_user_address } from "./users.js";
import { send_err_resp } from "./error.js";

const stripe = config.stripe_secret_key ? new Stripe(config.stripe_secret_key) : null;

function escape_html(value: string | undefined) {
    return (value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function normalize_address(input: any, current_id?: string): ss_user_address {
    return {
        id: current_id || new ObjectId().toString(),
        street: (input.street || "").trim(),
        street2: (input.street2 || "").trim(),
        city: (input.city || "").trim(),
        state: (input.state || "").trim(),
        zip: (input.zip || "").trim(),
        country: (input.country || "").trim(),
        is_default: input.is_default === "on",
    };
}

function validate_address(address: ss_user_address) {
    if (!address.street || !address.city || !address.state || !address.zip || !address.country) {
        return "Street, city, state, ZIP, and country are required";
    }
    return null;
}

function address_summary(address: ss_user_address) {
    const line2 = address.street2 ? `<div>${escape_html(address.street2)}</div>` : "";
    return `
        <div>${escape_html(address.street)}</div>
        ${line2}
        <div>${escape_html(address.city)}, ${escape_html(address.state)} ${escape_html(address.zip)}</div>
        <div>${escape_html(address.country)}</div>
    `;
}

function render_address_form(address?: ss_user_address, error?: string) {
    return render_fragment("settings-address-form.html", {
        address_id: address?.id || "",
        street: address?.street || "",
        street2: address?.street2 || "",
        city: address?.city || "",
        state: address?.state || "",
        zip: address?.zip || "",
        country: address?.country || "",
        checked: address?.is_default ? "checked" : "",
        form_title: address ? "Edit address" : "Add address",
        submit_label: address ? "Save address" : "Add address",
        cancel_html: address
            ? `<button class="base" type="button" hx-get="/api/settings/address-book" hx-target="#settings-address-book" hx-swap="outerHTML">Cancel</button>`
            : "",
        error_html: error ? `<div class="errors">${escape_html(error)}</div>` : "",
    });
}

function render_address_book(user: ss_user, editing_address_id?: string, error?: string) {
    const addresses = user.addresses || [];
    const editing_address = editing_address_id ? addresses.find((item) => item.id === editing_address_id) : undefined;
    const empty_html = `<p class="settings-empty">No saved addresses yet.</p>`;
    const list_html =
        addresses.length === 0
            ? empty_html
            : addresses
                  .map(
                      (address) => `
                <article class="address-card">
                  <div class="address-card-copy">
                    <div class="address-card-title">
                      <strong>${escape_html(address.is_default ? "Default address" : "Shipping address")}</strong>
                      ${address.is_default ? `<span class="address-badge">Default</span>` : ""}
                    </div>
                    ${address_summary(address)}
                  </div>
                  <div class="address-card-actions">
                    <button class="base" type="button" hx-get="/api/settings/addresses/${address.id}/edit" hx-target="#settings-address-book" hx-swap="outerHTML">Edit</button>
                    ${
                        address.is_default
                            ? ""
                            : `<button class="base" type="button" hx-post="/api/settings/addresses/${address.id}/default" hx-target="#settings-address-book" hx-swap="outerHTML">Make default</button>`
                    }
                    <button class="base" type="button" hx-post="/api/settings/addresses/${address.id}/delete" hx-target="#settings-address-book" hx-swap="outerHTML">Delete</button>
                  </div>
                </article>
            `
                  )
                  .join("");

    return render_fragment("settings-address-book.html", {
        address_list_html: list_html,
        address_form_html: render_address_form(editing_address, error),
    });
}

function render_stripe_status(user: ss_user, flash_message = "") {
    const seller = user.seller || {
        stripe_account_id: "",
        stripe_onboarding_complete: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
    };
    const status_lines = [
        seller.stripe_account_id ? `Account ID: ${escape_html(seller.stripe_account_id)}` : "No Stripe account linked yet.",
        `Onboarding complete: ${seller.stripe_onboarding_complete ? "Yes" : "No"}`,
        `Charges enabled: ${seller.stripe_charges_enabled ? "Yes" : "No"}`,
        `Payouts enabled: ${seller.stripe_payouts_enabled ? "Yes" : "No"}`,
    ]
        .map((line) => `<li>${line}</li>`)
        .join("");

    return render_fragment("settings-stripe-card.html", {
        stripe_status_html: status_lines,
        stripe_button_label: seller.stripe_account_id ? "Resume Stripe onboarding" : "Connect Stripe",
        stripe_flash_html: flash_message ? `<div class="save-success-ind">${escape_html(flash_message)}</div>` : "",
    });
}

async function load_user(users: Collection<ss_user>, req: Request, res: Response) {
    const liuser = req.liuser as liuser_payload;
    const user = await users.findOne({ _id: liuser.id });
    if (!user) {
        send_err_resp(404, "User not found", res);
        return null;
    }
    return user as ss_user;
}

export function create_settings_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const coll_name = process.env.USER_COLLECTION_NAME!;
    const users = db.collection<ss_user>(coll_name);
    const settings_router = Router();

    settings_router.get("/settings", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const flash_message = req.query.stripe === "return" ? "Stripe returned. Status refreshed below." : "";
            if (user.seller?.stripe_account_id && stripe) {
                const account = await stripe.accounts.retrieve(user.seller.stripe_account_id);
                const seller = {
                    stripe_account_id: account.id,
                    stripe_onboarding_complete: !!account.details_submitted,
                    stripe_charges_enabled: !!account.charges_enabled,
                    stripe_payouts_enabled: !!account.payouts_enabled,
                };
                await users.updateOne({ _id: user._id }, { $set: { seller } });
                user.seller = seller;
            }

            const html_txt = render_fragment("settings.html", {
                address_book_html: render_address_book(user),
                stripe_card_html: render_stripe_status(user, flash_message),
            });
            const index_html = render_fragment("index.html", { main_content_html: html_txt });
            res.type("html").send(index_html);
        } catch (err: any) {
            send_err_resp(500, `Could not load settings: ${err.message}`, res);
        }
    });

    settings_router.get("/api/settings/address-book", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            res.type("html").send(render_address_book(user));
        } catch (err: any) {
            send_err_resp(500, `Could not load addresses: ${err.message}`, res);
        }
    });

    settings_router.get("/api/settings/addresses/:address_id/edit", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }
            res.type("html").send(render_address_book(user, req.params.address_id));
        } catch (err: any) {
            send_err_resp(500, `Could not load address editor: ${err.message}`, res);
        }
    });

    settings_router.post("/api/settings/addresses", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const address_id = typeof req.body.address_id === "string" && req.body.address_id ? req.body.address_id : "";
            const next_address = normalize_address(req.body, address_id || undefined);
            const validation_error = validate_address(next_address);
            if (validation_error) {
                res.type("html").send(render_address_book(user, address_id || undefined, validation_error));
                return;
            }

            let addresses = [...(user.addresses || [])];
            const existing_index = address_id ? addresses.findIndex((item) => item.id === address_id) : -1;
            if (existing_index >= 0) {
                addresses[existing_index] = next_address;
            } else {
                addresses.push(next_address);
            }

            if (next_address.is_default || addresses.every((item) => !item.is_default)) {
                addresses = addresses.map((item) => ({ ...item, is_default: item.id === next_address.id }));
            }

            await users.updateOne({ _id: user._id }, { $set: { addresses } });
            res.type("html").send(render_address_book({ ...user, addresses }));
        } catch (err: any) {
            send_err_resp(500, `Could not save address: ${err.message}`, res);
        }
    });

    settings_router.post("/api/settings/addresses/:address_id/default", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const addresses = (user.addresses || []).map((item) => ({
                ...item,
                is_default: item.id === req.params.address_id,
            }));
            await users.updateOne({ _id: user._id }, { $set: { addresses } });
            res.type("html").send(render_address_book({ ...user, addresses }));
        } catch (err: any) {
            send_err_resp(500, `Could not update default address: ${err.message}`, res);
        }
    });

    settings_router.post("/api/settings/addresses/:address_id/delete", verify_liuser, async (req: Request, res: Response) => {
        try {
            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            let addresses = (user.addresses || []).filter((item) => item.id !== req.params.address_id);
            if (addresses.length > 0 && addresses.every((item) => !item.is_default)) {
                addresses[0] = {
                    ...addresses[0],
                    is_default: true,
                } as ss_user_address;
            }

            await users.updateOne({ _id: user._id }, { $set: { addresses } });
            res.type("html").send(render_address_book({ ...user, addresses }));
        } catch (err: any) {
            send_err_resp(500, `Could not delete address: ${err.message}`, res);
        }
    });

    settings_router.post("/api/settings/stripe/connect", verify_liuser, async (req: Request, res: Response) => {
        try {
            if (!stripe) {
                send_err_resp(503, "Stripe is not configured", res);
                return;
            }

            const user = await load_user(users, req, res);
            if (!user) {
                return;
            }

            const account_id = await ensure_seller_account(stripe, users, user);
            const account_link = await create_connect_onboarding_link(stripe, account_id);
            res.setHeader("HX-Redirect", account_link.url);
            res.status(204).end();
        } catch (err: any) {
            send_err_resp(500, `Could not start Stripe onboarding: ${err.message}`, res);
        }
    });

    return settings_router;
}
