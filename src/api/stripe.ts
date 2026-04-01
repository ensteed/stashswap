import { Router, type Request, type Response } from "express";
import Stripe from "stripe";
import { MongoClient, type Collection } from "mongodb";

import { config } from "../config.js";
import { send_err_resp } from "../api/error.js";
import type { ss_user } from "../api/users.js";

const stripe = config.stripe_secret_key ? new Stripe(config.stripe_secret_key) : null;

function require_stripe(res: Response): Stripe | null {
    if (!stripe) {
        send_err_resp(503, "Stripe is not configured", res);
        return null;
    }
    return stripe;
}

function map_account_status(account: Stripe.Account) {
    return {
        stripe_account_id: account.id,
        stripe_onboarding_complete: !!account.details_submitted,
        stripe_charges_enabled: !!account.charges_enabled,
        stripe_payouts_enabled: !!account.payouts_enabled,
    };
}

export function create_stripe_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const coll_name = process.env.USER_COLLECTION_NAME!;
    const users = db.collection<ss_user>(coll_name);
    const stripe_router = Router();

    stripe_router.post("/", async (req: Request, res: Response) => {
        const stripe_client = require_stripe(res);
        if (!stripe_client) {
            return;
        }
        if (!config.stripe_webhook_secret) {
            send_err_resp(503, "Stripe webhook secret is not configured", res);
            return;
        }

        const signature = req.headers["stripe-signature"];
        if (!signature || Array.isArray(signature)) {
            send_err_resp(400, "Missing Stripe signature", res);
            return;
        }

        try {
            const event = stripe_client.webhooks.constructEvent(req.body, signature, config.stripe_webhook_secret);

            if (event.type.startsWith("account.")) {
                const account = event.data.object as Stripe.Account;
                await users.updateOne(
                    { "seller.stripe_account_id": account.id },
                    { $set: { seller: map_account_status(account) } }
                );
            }

            res.status(200).json({ received: true });
        } catch (err: any) {
            wlog("Stripe webhook error:", err.message);
            send_err_resp(400, `Stripe webhook error: ${err.message}`, res);
        }
    });

    return stripe_router;
}

export async function ensure_seller_account(stripe_client: Stripe, users: Collection<ss_user>, user: ss_user) {
    if (user.seller?.stripe_account_id) {
        return user.seller.stripe_account_id;
    }

    const account = await stripe_client.accounts.create({
        type: "express",
        email: user.email,
        business_type: "individual",
        metadata: {
            user_id: user._id,
            username: user.username,
        },
    });

    await users.updateOne(
        { _id: user._id },
        {
            $set: {
                "seller.stripe_account_id": account.id,
            },
        }
    );

    return account.id;
}

export async function create_connect_onboarding_link(
    stripe_client: Stripe,
    account_id: string,
    return_path = "/settings"
) {
    return stripe_client.accountLinks.create({
        account: account_id,
        refresh_url: `${config.app_base_url}${return_path}?stripe=refresh`,
        return_url: `${config.app_base_url}${return_path}?stripe=return`,
        type: "account_onboarding",
    });
}
