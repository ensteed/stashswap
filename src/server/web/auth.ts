import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { MongoClient, Collection } from "mongodb";
import bc from "bcrypt";
import jwt from "jsonwebtoken";

import template from "../template.js";
import { rethrow_http_error, make_http_error, create_err_resp } from "./error.js";
import type { ss_user } from "./users.js";
import { amanifest } from "../assets.js";
import { config } from "../config.js";

declare module "fastify" {
    interface FastifyRequest {
        liuser?: liuser_payload;
    }
}

const SECRET_JWT_KEY = config.auth.secret_jwt_key;
asrt(SECRET_JWT_KEY);

export type liuser_payload = jwt.JwtPayload & {
    id: string;
};

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

export async function maybe_liuser(request: FastifyRequest, _reply: FastifyReply) {
    if (!request.cookies["token"]) {
        return;
    }
    try {
        request.liuser = await verify_token(request.cookies["token"]);
    } catch (err: any) {
        ilog("Optional auth failed: ", err);
    }
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

async function compare_password(pt_pwd: string, hashed_pwd: string): Promise<boolean> {
    try {
        const match = await bc.compare(pt_pwd, hashed_pwd);
        return match;
    } catch (err: any) {
        throw make_http_error("Password comparison failed: " + err.message, 500);
    }
}

export async function create_user_session(reply: FastifyReply, user_id: string) {
    try {
        const token = await sign_token(user_id);
        reply.setCookie("token", token, {
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "strict",
            maxAge: 60 * 60, // 1 hour in seconds
        });
    } catch (err: any) {
        throw make_http_error("Failed to create user session: " + err.message, 500);
    }
}

export async function verify_liuser(request: FastifyRequest, reply: FastifyReply) {
    if (!request.cookies["token"]) {
        reply.redirect("/login");
        return;
    }
    try {
        request.liuser = await verify_token(request.cookies["token"]);
    } catch (err: any) {
        ilog("Failed to verify user: ", err);
        throw err;
    }
}

export function clear_user_session(reply: FastifyReply) {
    reply.clearCookie("token", {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "strict",
    });
}

async function create_fake_login_timeout(usr: ss_user): Promise<void> {
    return new Promise<void>((resolve) => {
        setTimeout(() => {
            resolve();
        }, 1000);
    });
}

export function create_auth_routes(mongo_client: MongoClient): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        const db = mongo_client.db(config.mongo.db);
        const users = db.collection<ss_user>(config.mongo.users);

        // login returns an error html message if fails, and returns swaps for success.
        const login = async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                const body = request.body as { email: string; pwd: string };
                const { email, pwd: plain_text_pwd } = body;
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

                await create_user_session(reply, usr._id);
                ilog(`${usr.username} - ${usr.email} (${usr._id}) logged in successfully`);
                await create_fake_login_timeout(usr);
                reply.header("HX-Redirect", "/dashboard");
                reply.type("html").send("");
            } catch (err: any) {
                rethrow_http_error(err);
                reply.type("html").send(create_err_resp(err));
            }
        };

        const logout = (_request: FastifyRequest, reply: FastifyReply) => {
            clear_user_session(reply);
            reply.redirect("/");
        };

        const me = async (request: FastifyRequest, reply: FastifyReply) => {
            if (!request.headers["hx-request"]) {
                reply.redirect("/");
                return;
            }
            
            if (!request.liuser) {
                ilog("me: user not logged in");
                reply
                    .type("html")
                    .send(template.render_partial("navbar-right-not-logged-in.html", { icons_path: amanifest.icons }));
                return;
            }

            try {
                const usr = await get_user_from_id(request.liuser.id, users);
                if (!usr) {
                    throw new Error(`User with id ${request.liuser.id} not found in database`);
                }
                
                ilog(`User ${usr.username} - ${usr.email} (${usr._id}) logged in`);
                reply.type("html").send(
                    template.render_partial("navbar-right-logged-in", {
                        first_name: usr.first_name ?? "",
                        icons_path: amanifest.icons,
                    })
                );
            } catch (err: any) {
                rethrow_http_error(err);
                reply.type("html").send(create_err_resp(err));
            }
        };

        const get_login_page = (request: FastifyRequest, reply: FastifyReply) => {
            const login_html = template.render_partial("login");
            if (request.headers["hx-request"]) {
                reply.type("html").send(login_html);
            }
            else {
                const html = template.render_page_layout("landing", {}, "main", { modal_root_content: login_html });
                reply.type("html").send(html);
            }
        }

        fastify.get("/login", get_login_page);
        fastify.post("/login", login);
        fastify.post("/logout", logout);
        fastify.get("/me", { preHandler: maybe_liuser }, me);
    };
}
