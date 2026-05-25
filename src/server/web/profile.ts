import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { Collection, type UpdateResult, type UpdateFilter } from "mongodb";
import { sanitize_image, verify_buffer_is_image } from "../util.js";
import aws from "../services/aws.js";
import config from "../config.js";
import template from "../template.js";
import mongo from "../db.js";
import { verify_liuser, clear_user_session, type liuser_payload } from "./auth.js";
import { type ss_user } from "../models/ss_user.js";
import { make_http_error, is_http_error } from "./error.js";
import { amanifest } from "../assets.js";

async function update_user(
    user_id: string,
    update_op: UpdateFilter<ss_user>,
    users: Collection<ss_user>
): Promise<UpdateResult> {
    try {
        return await users.updateOne({ _id: user_id }, update_op);
    } catch (err: any) {
        throw make_http_error(`Server error on updating ${user_id}: ${err.message}`, 500);
    }
}

async function upload_profile_pic_to_s3(user_id: string, data: Buffer) {
    const s3_key = config.aws.s3_profile_pics_pf + `${user_id}.webp`;
    const mime_type = "image/webp";
    await aws.upload_to_s3(s3_key, data, mime_type);
}

function create_upload_pfp_html(pfp_s3_key: string, err_msg: string | null): string {
    const main_img = `<img src="${pfp_s3_key}">`;
    const errs = `<div id="edit_profile_pic_errs" hx-swap-oob="innerHTML">${err_msg ? err_msg : ""}</div>`;
    if (err_msg) {
        ilog("Sending upload pfp err response ", err_msg);
    }
    return main_img + "\n" + errs;
}

function create_update_pfp_html(err_msg: string | null) {
    const html_class = err_msg ? "temp-item errors" : "temp-item save-success-ind";
    const txt = err_msg ? err_msg : "Saved!";
    const item_id = "edit_profile_temp_op_indicator";
    const html = `<div id="${item_id}" class="${html_class}">${txt}</div>`;
    if (err_msg) {
        ilog("Sending upload pfp err response ", err_msg);
    }
    return html;
}

async function get_logged_in_user(user_id: string, users: Collection<ss_user>) {
    try {
        return await users.findOne({ _id: user_id });
    } catch (err: any) {
        throw make_http_error("Problem with db query: " + err.message, 500);
    }
}

async function handle_get_edit_profile(request: FastifyRequest, reply: FastifyReply) {
    reply.type("text/html");
    const users = mongo.get_users();
    const liusr = request.liuser as liuser_payload;
    const usr = await get_logged_in_user(liusr.id, users);
    if (!usr) {
        wlog(`User ${liusr.id} not found in db - likely removed while logged in`);
        clear_user_session(reply);
        reply.header("HX-Redirect", "/login");
        return "";
    }
    const index_html = template.render_page_layout("edit-profile", {
        pfp_s3_key: usr.profile.pfp_s3_key,
        public_name: usr.profile.public_name,
        profile_about: usr.profile.about,
        default_pfp: amanifest.default_profile_pic,
    });
    return index_html;
}

async function handle_post_profile_pic(request: FastifyRequest, reply: FastifyReply) {
    reply.type("text/html");
    const users = mongo.get_users();
    const usr = request.liuser as liuser_payload;
    const default_pfp = "default.png";
    try {
        const part = await request.file();
        if (!part) {
            throw new Error("No file uploaded");
        }

        const buffer = await part.toBuffer();

        if (!verify_buffer_is_image(buffer)) {
            throw new Error("Uploaded file is not a valid image");
        }

        const data = await sanitize_image(buffer, 512, 512, { fit: "cover", withoutEnlargement: true });

        const pfp_s3_key = `${config.aws.s3_base_url}/${config.aws.s3_profile_pics_pf}/${usr.id}.webp`;
        const update_op = { $set: { "profile.pfp_s3_key": pfp_s3_key } };
        const result = await update_user(usr.id, update_op, users);

        if (result.matchedCount === 0) {
            wlog(`User ${usr.id} not found in db - likely removed while logged in`);
            clear_user_session(reply);
            reply.header("HX-Redirect", "/login");
            return "";
        }

        await upload_profile_pic_to_s3(usr.id, data);
        return create_upload_pfp_html(pfp_s3_key, null);
    } catch (err: any) {
        if (!is_http_error(err)) {
            return create_upload_pfp_html(default_pfp, err);
        } else {
            throw err;
        }
    }
}

async function handle_post_profile(request: FastifyRequest, reply: FastifyReply) {
    reply.type("text/html");
    const users = mongo.get_users();
    const usr = request.liuser as liuser_payload;
    const body = request.body as { public_name: string; about: string };
    const { public_name, about } = body;
    const update_op = {
        $set: {
            "profile.public_name": public_name,
            "profile.about": about,
        },
    };

    const result = await update_user(usr.id, update_op, users);

    if (result.acknowledged && result.matchedCount == 1) {
        ilog(`Updated user ${usr.id} profile.public_name to ${public_name} and about to ${about}`);
        return create_update_pfp_html(null);
    } else if (result.acknowledged) {
        wlog(`User ${usr.id} not found in db - likely removed while logged in`);
        clear_user_session(reply);
        reply.header("HX-Redirect", "/login");
        return "";
    } else {
        throw make_http_error("Database update failed", 500);
    }
}

export function create_profile_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });
        fastify.get("/profile", { preHandler: verify_liuser }, handle_get_edit_profile);
        fastify.post("/profile", { preHandler: verify_liuser }, handle_post_profile);
        fastify.post("/profile/pic", { preHandler: verify_liuser }, handle_post_profile_pic);
    };
}
