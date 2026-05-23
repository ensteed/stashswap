import "./bootstrap.js";

import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";

import template from "./template.js";
import { create_auth_routes, verify_liuser, type liuser_payload } from "./web/auth.js";
import { create_profile_routes } from "./web/profile.js";
import { create_user_routes} from "./web/users.js";
import { create_listing_routes } from "./web/listings.js";
import { create_upload_api_routes } from "./api/upload.js";

import * as emapi from "./services/email.js";
import { is_http_error, create_err_resp, make_http_error } from "./web/error.js";
import config from "./config.js";
import mongo from "./db.js"
import { get_local_ip } from "./util.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const port = config.port;

async function start_server() {
    await mongo.connect_to_db();

    const fastify = Fastify();
    fastify.addHook("onRequest", async (request) => {
        dlog("Request URL:", request.url);
    });

    fastify.register(fastifyCookie);
    fastify.register(fastifyFormbody);
    fastify.register(fastifyStatic, {
        root: path.join(__dirname, "../public"),
        prefix: "/",
    });

    fastify.get("/", async (_request, reply) => {
        const html = template.render_page_layout("landing");
        reply.type("text/html").send(html);
    });

    fastify.get("/orders", async (_request, reply) => {
        reply.type("text/html").send(template.render_page_layout("orders"));
    });

    // TODO: This needs to move to web/dashboard (pretty much all of these need to move to their own handling thing)
    fastify.get("/dashboard", {preHandler: verify_liuser}, async (request, reply) => {
        const users = mongo.get_users();
        const usr = request.liuser as liuser_payload;
        let name = "";
        try {
            const full_usr = await users.findOne({ _id: usr.id });
            if (!full_usr) {
                throw new Error(`User with id ${usr.id} not found in database`);
            }
            name = full_usr.first_name;
        } catch (err: any) {
            throw make_http_error("Problem with db query: " + err.message, 500);
        }
        reply.type("text/html").send(template.render_page_layout("dashboard", {first_name: name}));
    });

    fastify.get("/messages", async (_request, reply) => {
        reply.type("text/html").send(template.render_page_layout("messages"));
    });

    fastify.get("/settings", async (_request, reply) => {
        reply.type("text/html").send(template.render_page_layout("settings"));
    });

    fastify.get("/test-email", async (_request, _reply) => {
        const em_body: emapi.email_body = {
            to: "daniel@zetrick.com",
            from: "daniel@noblesteed.dev",
            subject: "Test email from Ensteed",
            html: "<p>This is a test email sent from the Ensteed server.</p>",
        };
        emapi.send_email(em_body, (_resp) => {});
    });

    fastify.register(create_profile_routes());
    fastify.register(create_auth_routes());
    fastify.register(create_user_routes());
    fastify.register(create_listing_routes());
    fastify.register(create_upload_api_routes());

    fastify.setErrorHandler((err: any, _request, reply) => {
        if (is_http_error(err)) {
            reply
                .status(err.status as number)
                .type("text/html")
                .send(create_err_resp(err));
        } else {
            elog("Unexpected error in request handler:", err);
        }
    });

    fastify.setNotFoundHandler((request, reply) => {
        const html = template.render_layout("404", { url: request.url });
        reply.status(404).type("text/html").send(html);
    });

    try {
        await fastify.listen({ port: port, host: '0.0.0.0' });
        ilog(`Server listening at:`);
        ilog(`- Local:   http://localhost:${port}`);
        ilog(`- IP   :   http://${get_local_ip()}:${port}`);
        
    } catch (err) {
        elog("Server failed to start:", err);
    }
}

start_server();
