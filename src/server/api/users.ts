import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { MongoClient, ObjectId, Collection, type InsertOneResult } from "mongodb";
import bc from "bcrypt";
import { create_err_resp, rethrow_http_error, make_http_error } from "./error.js";
import { create_logged_in_resp } from "./auth.js";

export interface ss_user_profile {
    pfp_s3_key: string;
    about: string;
    public_name: string;
}

export interface ss_user_address {
    id: string;
    street: string;
    street2: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    is_default: boolean;
}

export interface ss_user_seller {
    stripe_account_id: string;
    stripe_onboarding_complete: boolean;
    stripe_charges_enabled: boolean;
    stripe_payouts_enabled: boolean;
}

const DEFAULT_PROFILE: ss_user_profile = {
    pfp_s3_key: "",
    about: "",
    public_name: "",
};

const DEFAULT_SELLER: ss_user_seller = {
    stripe_account_id: "",
    stripe_onboarding_complete: false,
    stripe_charges_enabled: false,
    stripe_payouts_enabled: false,
};

export interface ss_user {
    _id: string;
    username: string;
    first_name: string;
    last_name: string;
    email: string;
    pwd: string;
    profile: ss_user_profile;
    addresses: ss_user_address[];
    seller: ss_user_seller;
}

const DEFAULT_USER: ss_user = {
    _id: "",
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    pwd: "",
    profile: DEFAULT_PROFILE,
    addresses: [],
    seller: DEFAULT_SELLER,
};

// - At least one lowercase letter (=(?=.*[a-z])=)
// - At least one uppercase letter (=(?=.*[A-Z])=)
// - At least one digit (=(?=.*\d)=)
// - At least one special character (=(?=.*[@$!%*?&#])=)
// - Minimum length of 8 characters (={8,}=)
//const password_regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
const password_regex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&])[A-Za-z\d!@#$%^&]{8,}$/;
const username_regex = /^(?=.{3,}$)(?!.*[_-]{2,})(?![_-])(?!.*[_-]$)[\w-]*$/;

interface error_info {
    code: number;
    message: string;
}

type create_user_callback = (new_user: ss_user | null, error: error_info | null) => void;

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
    new_user._id = new ObjectId().toString();
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

export function create_user_routes(mongo_client: MongoClient): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        const db = mongo_client.db(process.env.DB_NAME);
        const coll_name = process.env.USER_COLLECTION_NAME!;
        const users = db.collection<ss_user>(coll_name);

        async function create_user_req(request: FastifyRequest, reply: FastifyReply) {
            const body = request.body as Record<string, string>;
            const new_user = { ...DEFAULT_USER, ...body };
            new_user.first_name = body["name"] ?? "";
            new_user.last_name = "";
            try {
                await create_user(new_user, users);
            } catch (err: any) {
                rethrow_http_error(err);
                reply.type("html").send(create_err_resp(err));
            }
        }

        async function create_user_and_login_req(request: FastifyRequest, reply: FastifyReply) {
            const body = request.body as Record<string, string>;
            const new_user = { ...DEFAULT_USER, ...body };
            new_user.first_name = body["name"] ?? "";
            new_user.last_name = "";
            try {
                await create_user(new_user, users);
                reply.type("html").send(create_logged_in_resp(new_user));
            } catch (err: any) {
                rethrow_http_error(err);
                reply.type("html").send(create_err_resp(err));
            }
        }

        fastify.post("/api/users", create_user_req);
        fastify.post("/api/users/login", create_user_and_login_req);
    };
}
