import { type Request, type Response, type NextFunction, Router } from "express";
import { MongoClient, Collection } from "mongodb";
import bc from "bcrypt";
import jwt from "jsonwebtoken";

import template, { render_fragment, render_loaded_fragment } from "../template.js";
import { rethrow_http_error, make_http_error, create_err_resp } from "./error.js";
import type { ss_user } from "./users.js";

const SECRET_JWT_KEY = process.env.SECRET_JWT_KEY!;
asrt(SECRET_JWT_KEY);

export type liuser_payload = jwt.JwtPayload & {
    id: string;
};

declare global {
    namespace Express {
        interface Request {
            liuser?: liuser_payload;
        }
    }
}

export function send_unauthorized_response(res: Response) {
    const login_html = template.render_fragment("login.html", { hidden_class: "hidden" });
    const index_with_login = template.render_fragment("index.html", { sign_in_fragment: login_html });
    res.status(200).type("html").send(index_with_login);
}

export function create_logged_in_resp(usr: ss_user): string {
    const remove_modal = `<div id="modal-root" hx-swap-oob="true"></div>`;
    const main_page = `<div id="main-content" hx-swap-oob="true">{{> dashboard.html}}</div>`;
    // This element is a out of band swap element so will correctly replace the navbar with the logged in one
    const replaced_navbar = `{{> navbar-right-logged-in.html}}`;
    const html = render_loaded_fragment(remove_modal + main_page + replaced_navbar, {
        first_name: usr.first_name,
    });
    return html;
}

async function verify_token(token: string) {
    return new Promise<liuser_payload>((resolve, reject) => {
        jwt.verify(
            token,
            SECRET_JWT_KEY,
            (err: jwt.VerifyErrors | null, decoded: jwt.JwtPayload | string | undefined) => {
                if (err) {
                    reject(err);
                } else if (!decoded) {
                    reject(new Error("Missing decoded token"));
                } else {
                    resolve(decoded as liuser_payload);
                }
            }
        );
    });
}

// This can be used as "middleware" for protected routes. Just understand that failure returns a 401 response which, when using htmx,
// will return the errmsg fragment.
export async function maybe_liuser(req: Request, res: Response, next: NextFunction) {
    if (!req.cookies.token) {
        next();
        return;
    }
    try {
        req.liuser = await verify_token(req.cookies.token);
    } catch (err: any) {
        ilog("Optional auth failed: ", err);
    }
    next();
}

async function get_user_from_email(email: string, users: Collection<ss_user>): Promise<ss_user | null> {
    try {
        const usr = await users.findOne({ email: email });
        return usr;
    } catch (err: any) {
        throw make_http_error("DB operation failed: " + err.message, 500);
    }
}

async function get_user_from_id(id: string, users: Collection<ss_user>): Promise<ss_user | null> {
    try {
        const usr = await users.findOne({ _id: id });
        return usr;
    } catch (err: any) {
        throw make_http_error("DB operation failed: " + err.message, 500);
    }
}

// This function signs a token with the user id as the payload, and a secret key, and an expiration time of 1 hour, and returns the token as a promise
async function sign_token(user_id: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        jwt.sign({ id: user_id }, SECRET_JWT_KEY, { expiresIn: "1h" }, (err, token) => {
            if (err) {
                reject(err);
            } else if (!token) {
                reject(new Error("Failed to sign token: No token returned"));
            } else {
                resolve(token);
            }
        });
    });
}

// Wrap bc compare to make an http error on failure
async function compare_password(pt_pwd: string, hashed_pwd: string): Promise<boolean> {
    try {
        const match = await bc.compare(pt_pwd, hashed_pwd);
        return match;
    } catch (err: any) {
        throw make_http_error("Password comparison failed: " + err.message, 500);
    }
}

//
async function create_user_session(res: Response, user_id: string) {
    try {
        const token = await sign_token(user_id);
        res.cookie("token", token, {
            httpOnly: true,
            secure: false, // true if using https
            sameSite: "strict",
            maxAge: 60 * 60 * 1000, // 1 hour
        });
    } catch (err: any) {
        throw make_http_error("Failed to create user session: " + err.message, 500);
    }
}

// This can be used as "middleware" for protected routes. Just understand that failure returns a 401 response which, when using htmx,
// will return the errmsg fragment.
export async function verify_liuser(req: Request, res: Response, next: NextFunction) {
    if (!req.cookies.token) {
        send_unauthorized_response(res);
        return;
    }
    try {
        req.liuser = await verify_token(req.cookies.token);
        next();
    } catch (err: any) {
        ilog("Failed to verify user: ", err);
        next(err);
    }
}

export function clear_user_session(res: Response) {
    res.clearCookie("token", {
        httpOnly: true,
        secure: false,
        sameSite: "strict",
    });
}

export function create_auth_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const coll_name = process.env.USER_COLLECTION_NAME!;
    const users = db.collection<ss_user>(coll_name);

    // LOGIN
    const login = async (req: Request, res: Response) => {
        try {
            // desctructuring - pull username from body and store it as unsername_or_email, and pwd as plain_text_pwd
            const { email: email, pwd: plain_text_pwd } = req.body;
            if (!email || !plain_text_pwd) {
                throw new Error("Username and password are required");
            }

            const usr = await get_user_from_email(email, users);
            if (!usr) {
                throw new Error("User not found");
            }

            const match = await compare_password(plain_text_pwd, usr.pwd);
            if (!match) {
                throw new Error("Incorrect password");
            }

            await create_user_session(res, usr._id);
            ilog(`${usr.username} - ${usr.email} (${usr._id}) logged in successfully`);

            // On login, we want to show the user dashboard, and not a json message
            setTimeout(() => {
                res.type("html").send(create_logged_in_resp(usr));
            }, 1000);
        } catch (err: any) {
            rethrow_http_error(err);
            res.type("html").send(create_err_resp(err));
        }
    };

    // LOGOUT
    const logout = (_req: Request, res: Response) => {
        clear_user_session(res);
        res.type("html").send(render_fragment("logout.html"));
    };

    const me = async (req: Request, res: Response) => {
        if (!req.liuser) {
            ilog("me: user not logged in");
            res.type("html").send(render_fragment("navbar-right-not-logged-in.html"));
            return;
        }

        try {
            const usr = await get_user_from_id(req.liuser.id, users);
            if (!usr) {
                throw new Error(`User with id ${req.liuser.id} not found in database`);
            }

            ilog(`User ${usr.username} - ${usr.email} (${usr._id}) logged in`);
            res.type("html").send(
                render_fragment("navbar-right-logged-in.html", {
                    first_name: req.liuser.first_name,
                    icon_ver: req.app.locals.ICON_VER,
                })
            );
        } catch (err: any) {
            rethrow_http_error(err);
            res.type("html").send(create_err_resp(err));
        }
    };

    const auth_router = Router();
    auth_router.post("/api/login", login);
    auth_router.post("/api/logout", logout);
    auth_router.get("/api/me", maybe_liuser, me);
    return auth_router;
}
