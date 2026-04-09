import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { MongoClient, Collection, type UpdateResult, type UpdateFilter } from "mongodb";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { config } from "../config.js";
import { render_fragment } from "../template.js";
import { verify_liuser, clear_user_session, type liuser_payload } from "./auth.js";
import type { ss_user } from "./users.js";
import { make_http_error, is_http_error } from "./error.js";
import {amanifest} from "../assets.js";

const s3 = new S3Client({ region: config.s3_region });

async function sanitize_profile_pic(file_buffer: Buffer) {
    const sharp_img = sharp(file_buffer)
        .rotate()
        .resize(512, 512, { fit: "cover" })
        .toFormat("webp", { quality: 80 })
        .withMetadata({});
    try {
        const result = await sharp_img.toBuffer();
        return result;
    } catch (err: any) {
        throw make_http_error("Error processing image: " + err.message, 500);
    }
}

async function update_user(user_id: string, update_op: UpdateFilter<ss_user>, users: Collection<ss_user>): Promise<UpdateResult> {
    try {
        return await users.updateOne({ _id: user_id }, update_op);
    } catch (err: any) {
        throw make_http_error(`Server error on updating ${user_id}: ${err.message}`, 500);
    }
}

async function upload_profile_pic_to_s3(user_id: string, data: Buffer) {
    const s3_key = `${user_id}.webp`;
    const cmd = new PutObjectCommand({
        Bucket: config.s3_profile_pics_bucket,
        Key: s3_key,
        Body: data,
        ContentType: "image/webp",
    });

    try {
        await s3.send(cmd);
        ilog("Uploaded profile pic for user ", user_id, " to S3 key ", s3_key);
    } catch (err: any) {
        throw make_http_error("S3 upload failed: " + err.message, 500);
    }
}

function verify_buffer_is_image(buf: Buffer): boolean {
    const is_jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const is_png = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const is_riff = buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
    return is_jpeg || is_png || is_riff;
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

export function create_profile_routes(mongo_client: MongoClient): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });

        const db = mongo_client.db(process.env.DB_NAME);
        const coll_name = process.env.USER_COLLECTION_NAME!;
        const users = db.collection<ss_user>(coll_name);

        const edit_profile = async (request: FastifyRequest, reply: FastifyReply) => {
            const liusr = request.liuser as liuser_payload;
            const usr = await get_logged_in_user(liusr.id, users);

            if (!usr) {
                wlog(`User ${liusr.id} not found in db - likely removed while logged in`);
                clear_user_session(reply);
                reply.type("html").send(render_fragment("logout.html", {icons_path: amanifest.icons}));
                return;
            }

            const html_txt = render_fragment("edit-profile.html", {
                pfp_s3_key: usr.profile?.pfp_s3_key ?? "profile_pics/default.png",
                public_name: usr.profile?.public_name ?? usr.first_name,
                profile_about: usr.profile?.about,
            });

            const index_html = render_fragment("index.html", { main_content_html: html_txt });
            reply.type("html").send(index_html);
        };

        const upload_pfp = async (request: FastifyRequest, reply: FastifyReply) => {
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

                const data = await sanitize_profile_pic(buffer);

                const pfp_s3_key = `${config.s3_base_url}/${usr.id}.webp`;
                const update_op = { $set: { "profile.pfp_s3_key": pfp_s3_key } };
                const result = await update_user(usr.id, update_op, users);

                if (result.acknowledged && result.matchedCount == 1) {
                    await upload_profile_pic_to_s3(usr.id, data);
                    const html = create_upload_pfp_html(pfp_s3_key, null);
                    reply.type("html").send(html);
                } else if (result.acknowledged) {
                    wlog(`User ${usr.id} not found in db - likely removed while logged in`);
                    clear_user_session(reply);
                    reply.type("html").send(render_fragment("logout.html", {icons_path: amanifest.icons}));
                } else {
                    throw make_http_error("Database update failed", 500);
                }
            } catch (err: any) {
                if (!is_http_error(err)) {
                    const html = create_upload_pfp_html(default_pfp, err);
                    reply.type("html").send(html);
                } else {
                    throw err;
                }
            }
        };

        const update_profile = async (request: FastifyRequest, reply: FastifyReply) => {
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
                const html = create_update_pfp_html(null);
                reply.type("html").send(html);
            } else if (result.acknowledged) {
                wlog(`User ${usr.id} not found in db - likely removed while logged in`);
                clear_user_session(reply);
                reply.type("html").send(render_fragment("logout.html", {icons_path: amanifest.icons}));
            } else {
                throw make_http_error("Database update failed", 500);
            }
        };

        fastify.get("/profile", { preHandler: verify_liuser }, edit_profile);
        fastify.post("/profile", { preHandler: verify_liuser }, update_profile);
        fastify.post("/profile/pic", { preHandler: verify_liuser }, upload_pfp);
    };
}
