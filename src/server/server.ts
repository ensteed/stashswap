import "./bootstrap.js";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import { readFileSync } from "fs";

import template from "./template.js";
import { create_auth_routes } from "./api/auth.js";
import { create_profile_routes } from "./api/profile.js";
import { create_user_routes } from "./api/users.js";
import * as emapi from "./services/email.js";
import { is_http_error, create_err_resp } from "./api/error.js";
import { config } from "./config.js";
import { amanifest } from "./assets.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mdb_uri = config.mongodb_uri;
const mdb_client = new MongoClient(mdb_uri);
const port = parseInt(config.port);

async function start_server() {
    await mdb_client.connect();
    ilog("Connected to db");

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
        const params = {
            client_entry_point: amanifest.main,
            client_css: amanifest.css,
            main_content_html: "{{> landing.html}}",
        };
        ilog("Should be using params", params);
        const html = template.render_fragment("index.html", params);
        reply.type("html").send(template.render_loaded_fragment(html));
    });

    fastify.get("/login", async (_request, reply) => {
        reply.type("html").send(template.render_fragment("login.html"));
    });

    fastify.get("/create-account", async (_request, reply) => {
        reply.type("html").send(template.render_fragment("create-account.html"));
    });

    fastify.get("/orders", async (_request, reply) => {
        const params = {
            client_entry_point: amanifest.main,
            client_css: amanifest.css,
            main_content_html: "{{> orders.html}}",
        };
        const html = template.render_fragment("index.html", params);
        reply.type("html").send(template.render_loaded_fragment(html));
    });

    fastify.get("/messages", async (_request, reply) => {
        const params = {
            client_entry_point: amanifest.main,
            client_css: amanifest.css,
            main_content_html: "{{> messages.html}}",
        };
        const html = template.render_fragment("index.html", params);
        reply.type("html").send(template.render_loaded_fragment(html));
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

    fastify.register(create_profile_routes(mdb_client));
    fastify.register(create_auth_routes(mdb_client));
    fastify.register(create_user_routes(mdb_client));

    fastify.setErrorHandler(async (err: any, _request, reply) => {
        if (is_http_error(err)) {
            reply
                .status(err.status as number)
                .type("html")
                .send(create_err_resp(err));
        } else {
            elog("Unexpected error in request handler:", err);
        }
    });

    try {
        await fastify.listen({ port: port });
        ilog(`Server listening at:`);
        ilog(`- Local:   http://localhost:${port}`);
    } catch (err) {
        elog("Server failed to start:", err);
    }
}

start_server();
