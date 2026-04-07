import "./bootstrap.js";
import express from "express";
import cookie_parser from "cookie-parser";
import path from "path";
import bodyParser from "body-parser";
import { fileURLToPath } from "url";
import { MongoClient } from "mongodb";
import { readFileSync } from "fs";

import template from "./template.js";
import { create_auth_routes } from "./api/auth.js";
import { create_profile_routes } from "./api/profile.js";
import { get_local_ip } from "./util.js";
import { create_user_routes } from "./api/users.js";
import * as emapi from "./services/email.js";
import * as err from "./api/error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create the mongodb client
const mdb_uri = process.env.MONGODB_URI!;
asrt(mdb_uri);

// Pull in our port
const port = process.env.PORT!;
asrt(port);

const manifest = JSON.parse(readFileSync("public/asset-manifest.json", "utf8"));
const ICON_VER = manifest["icons.svg"]; // e.g. "a1b2c3d4"

// helper if you want it everywhere

const mdb_client = new MongoClient(mdb_uri);

function deb_req_func(req: express.Request, _res: express.Response, next: express.NextFunction) {
    dlog("Request URL:", req.url);
    next();
}

function top_level_http_error_handler(err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) {
    if (err.is_http_error(err)) {
        res.status(err.status).type('html').send(err.create_err_resp(err));
    }
    else {
        elog("Unexpected error in request handler:", err);
    }
}

async function start_server() {
    await mdb_client.connect();
    ilog("Connected to db");
    const app = express();

    // Hash icon file
    app.locals.ICON_VER = ICON_VER;

    // Set up a debug view of requests
    app.use(deb_req_func);

    // Handle cookies
    app.use(cookie_parser());

    // Parse json
    app.use(express.json());

    // Parse forms and such
    app.use(bodyParser.urlencoded({ extended: true }));

    // Serve assets
    app.use(express.static(path.join(__dirname, "../public")));

    // Send index.html
    app.get("/", function (_req, res) {
        const html = template.render_fragment("index.html", { main_content_html: "{{> landing.html}}" });
        res.type("html").send(template.render_loaded_fragment(html));
    });

    // Send create account
    app.get("/login", function (_req, res) {
        res.type("html").send(template.render_fragment("login.html"));
    });

    app.get("/create-account", function (_req, res) {
        res.type("html").send(template.render_fragment("create-account.html"));
    });

    app.get("/orders", function (_req, res) {
        const html = template.render_fragment("index.html", { main_content_html: "{{> orders.html}}" });
        res.type("html").send(template.render_loaded_fragment(html));
    });

    app.get("/messages", function (_req, res) {
        const html = template.render_fragment("index.html", { main_content_html: "{{> messages.html}}" });
        res.type("html").send(template.render_loaded_fragment(html));
    });

    app.get("/test-email", function (_req, res) {
        const cb = (resp: emapi.email_response) => {
        };
        const em_body: emapi.email_body = {
            to: "daniel@zetrick.com",
            from: "daniel@noblesteed.dev",
            subject: "Test email from Ensteed",
            html: "<p>This is a test email sent from the Ensteed server.</p>"};
        emapi.send_email(em_body, cb);
    });


    app.use("/", create_profile_routes(mdb_client));

    // Auth routes
    app.use("/", create_auth_routes(mdb_client));

    // User routes
    app.use("/", create_user_routes(mdb_client));

    // Error handling middleware should be last
    app.use(top_level_http_error_handler);

    // Handle 404s
    app.listen(port, (err?: Error) => {
        if (err) {
            elog("Server failed to start:", err);
            return;
        }

        const local_ip = get_local_ip();
        ilog(`Server listening at:`);
        ilog(`- Local:   http://localhost:${port}`);
        ilog(`- Network: http://${local_ip}:${port}`);
    });
}

start_server();
