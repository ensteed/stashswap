import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { ObjectId, Collection, type InsertOneResult } from "mongodb";
import bc from "bcrypt";
import { create_err_resp, rethrow_http_error, make_http_error } from "./error.js";
import { create_user_session } from "./auth.js";
import { type ss_user } from "../models/ss_user.js";
import template from "../template.js";
import mongo from "../db.js";

function create_default_user(): ss_user {
    return {
        _id: new ObjectId().toString(),
        created_at: new Date(),
        updated_at: new Date(),
        username: "",
        first_name: "",
        last_name: "",
        email: "",
        pwd: "",
        profile: {
            pfp_s3_key: "",
            about: "",
            public_name: "",
        },
        addresses: [],
        seller: {
            stripe_account_id: "",
            stripe_onboarding_complete: false,
            stripe_charges_enabled: false,
            stripe_payouts_enabled: false,
        },
    };
}

// - At least one lowercase letter (=(?=.*[a-z])=)
// - At least one uppercase letter (=(?=.*[A-Z])=)
// - At least one digit (=(?=.*\d)=)
// - At least one special character (=(?=.*[@$!%*?&#])=)
// - Minimum length of 8 characters (={8,}=)
//const password_regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
const password_regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&])[A-Za-z\d!@#$%^&]{8,}$/;
const username_regex = /^(?=.{3,}$)(?!.*[_-]{2,})(?![_-])(?!.*[_-]$)[\w-]*$/;

function format_user_first_last_name(usr: ss_user) {
    let trimmed_name = usr.first_name.trim();
    if (trimmed_name) {
        const splt = trimmed_name.split(/\s+/);
        if (splt.length > 1) {
            usr.last_name = splt.pop() as string;
            trimmed_name = splt.join(" ");
        }
        usr.first_name = trimmed_name;
    }
}

async function do_hash(pwd: string): Promise<string> {
    try {
        const result = await bc.hash(pwd, 10);
        return result;
    } catch (err: any) {
        throw make_http_error("Hashing failed: " + err.message, 500);
    }
}

async function insert_user(new_user: ss_user, users: Collection<ss_user>): Promise<InsertOneResult<ss_user>> {
    try {
        const result = await users.insertOne(new_user);
        return result;
    } catch (err: any) {
        throw make_http_error("DB operation failed: " + err.message, 500);
    }
}

async function hash_password_and_create_user(new_user: ss_user, users: Collection<ss_user>): Promise<void> {
    format_user_first_last_name(new_user);
    new_user.pwd = await do_hash(new_user.pwd);
    const usr_result = await insert_user(new_user, users);
    if (usr_result.insertedId != new_user._id) throw make_http_error("Unexpected id when creating user", 500);
}

async function find_exiting_user(new_user: ss_user, users: Collection<ss_user>): Promise<ss_user | null> {
    try {
        const usr = await users.findOne({ $or: [{ username: new_user.username }, { email: new_user.email }] });
        return usr;
    } catch (err: any) {
        throw make_http_error("DB query failed: " + err.message, 500);
    }
}

async function create_user(new_user: ss_user, users: Collection<ss_user>): Promise<void> {
    ilog("Got user creation request for ", new_user);
    if (!/\S+@\S+\.\S+/.test(new_user.email)) {
        throw new Error("Invalid email format");
    }

    if (!password_regex.test(new_user.pwd)) {
        throw new Error(`Password '${new_user.pwd}' does not meet guidelines`);
    }

    if (!username_regex.test(new_user.username)) {
        throw new Error(`Username '${new_user.username}' does not meet guidelines`);
    }

    const usr = await find_exiting_user(new_user, users);
    if (usr) throw new Error("User already exists");

    hash_password_and_create_user(new_user, users);
}

async function handle_post_create_account(request: FastifyRequest, reply: FastifyReply) {
    const users = mongo.get_users();
    const body = request.body as Record<string, string>;
    const new_user = { ...create_default_user(), ...body };
    new_user.first_name = body["name"] ?? "";
    new_user.last_name = "";
    try {
        await create_user(new_user, users);
        await create_user_session(reply, new_user._id);
        reply.header("HX-Redirect", "/dashboard");
        reply.type("text/html").send("");
    } catch (err: any) {
        rethrow_http_error(err);
        reply.type("text/html").send(create_err_resp(err));
    }
}

export function create_user_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.post("/create-account", handle_post_create_account);
        fastify.get("/create-account", (_request, reply) => {
            reply.type("text/html").send(template.render_partial("create-account"));
        });
    };
}
