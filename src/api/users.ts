import { type Request, type Response, Router } from "express";
import { MongoClient, ObjectId, Collection, type InsertOneResult } from "mongodb";
import bc from "bcrypt";
import { send_err_resp } from "./error.js";
import { sign_in_user_send_resp } from "./auth.js";

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

// This will split first and last name where last name will contain the last word after the last space, and first name will contain everything else
function format_user_first_last_name(usr: ss_user) {
    let trimmed_name = usr.first_name.trim(); // Trim any leading or trailing spaces.
    if (trimmed_name) {
        const splt = trimmed_name.split(/\s+/);
        if (splt.length > 1) {
            usr.last_name = splt.pop() as string;
            trimmed_name = splt.join(' ');
        }
        usr.first_name = trimmed_name;
    }
}

function hash_password_and_create_user(
    new_user: ss_user,
    users: Collection<ss_user>,
    done_callback: create_user_callback
) {
    // Set the new user's id
    new_user._id = new ObjectId().toString();

    // Split first and last name if we can
    format_user_first_last_name(new_user);

    // Hash function callback
    const on_hash_complete = (err: any, hash: string) => {
        // If there was a hash error - that is a server problem
        if (err) {
            done_callback(null, { code: 200, message: err.toString() });
            return;
        }

        // We successfully hashed the password - set it in the bsyr user and then insert the user in our collection
        new_user.pwd = hash;

        // Resolve and reject promise callbacks
        const on_insert_resolved = (result: InsertOneResult<ss_user>) => {
            if (result.insertedId == new_user._id) {
                done_callback(new_user, null);
            } else {
                done_callback(null, { code: 200, message: "Unexpected id when creating user" });
            }
        };
        const on_insert_reject = (reason: any) => {
            done_callback(null, { code: 200, message: reason.toString() });
        };

        // Insert the user and pass the promise the resolve and reject callbacks
        const insert_prom = users.insertOne(new_user);
        insert_prom.then(on_insert_resolved, on_insert_reject);
    };

    // Hash the user providing callback from above
    bc.hash(new_user.pwd, 10, on_hash_complete);
}

function create_user(new_user: ss_user, users: Collection<ss_user>, done_callback: create_user_callback) {
    ilog("Got user creation request for ", new_user);
    if (!/\S+@\S+\.\S+/.test(new_user.email)) {
        done_callback(null, { code: 200, message: "Invalid email format" });
        return;
    }

    if (!password_regex.test(new_user.pwd)) {
        done_callback(null, { code: 200, message: `Password '${new_user.pwd}' does not meet guidelines` });
        return;
    }

    if (!username_regex.test(new_user.username)) {
        done_callback(null, { code: 200, message: "Username does not meet guidelines" });
        return;
    }

    // First, check if there is an existing user
    const exists_user_check_complete = (found_usr: ss_user | null) => {
        if (found_usr) {
            done_callback(null, { code: 200, message: "User already exists" });
        } else {
            hash_password_and_create_user(new_user, users, done_callback);
        }
    };
    const exists_user_check_rejected = (reason: any) => {
        done_callback(null, { code: 200, message: "Server request failed: " + reason });
    };

    const existing_usr_prom = users.findOne({ $or: [{ username: new_user.username }, { email: new_user.email }] });
    existing_usr_prom.then(exists_user_check_complete, exists_user_check_rejected);
}

export function create_user_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const coll_name = process.env.USER_COLLECTION_NAME!;
    const users = db.collection<ss_user>(coll_name);

    function create_user_req(req: Request, res: Response) {
        const new_user = { ...DEFAULT_USER, ...req.body };
        new_user.first_name = req.body.name;
        new_user.last_name = "";
        const on_done_cb = (new_user: ss_user | null, error: error_info | null) => {
            if (new_user) {
                res.type("html").send("<h2>Success</h2>");
            } else if (error) {
                send_err_resp(error.code, error.message, res);
            } else {
                send_err_resp(500, "Unknown error", res);
            }
        };
        create_user(new_user, users, on_done_cb);
    }

    // Get a specific user by id
    function create_user_and_login_req(req: Request, res: Response) {
        const new_user = { ...DEFAULT_USER, ...req.body };
        new_user.first_name = req.body.name;
        new_user.last_name = "";
        const on_done_cb = (new_user: ss_user | null, error: error_info | null) => {
            if (new_user) {
                sign_in_user_send_resp(new_user, res);
            } else if (error) {
                send_err_resp(200, error.message, res);
            } else {
                send_err_resp(200, "Unknown error", res);
            }
        };
        create_user(new_user, users, on_done_cb);
    }

    const user_router = Router();
    user_router.post("/api/users", create_user_req);
    user_router.post("/api/users/login", create_user_and_login_req);

    return user_router;
}
