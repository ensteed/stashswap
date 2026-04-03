import { type Request, type Response, type NextFunction, Router } from "express";
import { MongoClient, Collection, type UpdateResult } from "mongodb";
import multer from "multer";
import sharp from "sharp";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

import { config } from "../config.js";
import { render_fragment } from "../template.js";
import { verify_liuser, sign_out_user_send_resp, type liuser_payload } from "./auth.js";
import type { ss_user } from "./users.js";
import { send_err_resp } from "./error.js";

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 }, // 4MB
});

// This is the "middleware" muliter func - basically just processes multipart requests and puts the file result in the req.file
const multer_profile_func = upload.single("profile_pic");

async function sanitize_profile_pic(file_buffer: Buffer) {
    const sharp_img = sharp(file_buffer)
        .rotate()
        .resize(512, 512, { fit: "cover" })
        .toFormat("webp", { quality: 80 })
        .withMetadata({});
    return sharp_img.toBuffer();
}

function verify_buffer_is_image(buf: Buffer): boolean {
    // minimal magic-byte checks (JPEG/PNG/WebP). Add stricter checks as needed.
    const is_jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const is_png = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const is_riff = buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP";
    return is_jpeg || is_png || is_riff;
}

function send_upload_pfp_err_response(res: Response, pfp_s3_key: string, err_msg: string | null) {
    const main_img = `<img src="${pfp_s3_key}">`;
    const errs = `<div id="edit_profile_pic_errs" hx-swap-oob="innerHTML">${err_msg ? err_msg : ""}</div>`;
    if (err_msg) {
        ilog("Sending upload pfp err response ", err_msg);
    }
    res.type("html").send(main_img + "\n" + errs);
}

function send_update_profile_response(res: Response, err_msg: string | null) {
    const html_class = err_msg ? "temp-item errors" : "temp-item save-success-ind";
    const txt = err_msg ? err_msg : "Saved!";
    const item_id = "edit_profile_temp_op_indicator";
    const html = `<div id="${item_id}" class="${html_class}">${txt}</div>`;
    if (err_msg) {
        ilog("Sending upload pfp err response ", err_msg);
    }
    res.type("html").send(html);
}

const s3 = new S3Client({ region: config.s3_region });

export function create_profile_routes(mongo_client: MongoClient): Router {
    const db = mongo_client.db(process.env.DB_NAME);
    const coll_name = process.env.USER_COLLECTION_NAME!;
    const users = db.collection<ss_user>(coll_name);

    // Get edit profile page
    const edit_profile = async (req: Request, res: Response) => {
        const liusr = req.liuser as liuser_payload;
        let usr: ss_user | null = null;
        try {
            // desctructuring - pull username from body and store it as unsername_or_email, and pwd as plain_text_pwd
            usr = await users.findOne({ _id: liusr.id });
        } catch (err: any) {
            send_err_resp(500, "Could not retrieve user profile: " + err.message, res);
        }

        if (!usr) {
            sign_out_user_send_resp(res);
            return;
        }

        // If everything succeeds, this is what we do
        const html_txt = render_fragment("edit-profile.html", {
            pfp_s3_key: usr.profile?.pfp_s3_key ?? "profile_pics/default.png",
            public_name: usr.profile?.public_name ?? usr.first_name,
            profile_about: usr.profile?.about,
        });

        const index_html = render_fragment("index.html", { main_content_html: html_txt });
        res.type("html").send(index_html);
    };

    // return profile pic
    const upload_pfp = async (req: Request, res: Response) => {
        const usr = req.liuser as liuser_payload;
        const default_pfp = "default.png";
        if (!req.file || !req.file.buffer) {
            send_upload_pfp_err_response(res, default_pfp, "No file uploaded");
            return;
        }

        if (!verify_buffer_is_image(req.file.buffer)) {
            send_upload_pfp_err_response(res, default_pfp, "Uploaded file is not an image");
            return;
        }

        const data = await sanitize_profile_pic(req.file.buffer).catch((err) => {
            send_upload_pfp_err_response(res, default_pfp, "Failed to sanitize image: " + err.message);
            return;
        });
        
        if (!data) {
            send_upload_pfp_err_response(res, default_pfp, "No image data");
            return;
        }

        const pfp_s3_key = `${config.s3_base_url}/${usr.id.toString()}.webp`;
        const update_op = { $set: { "profile.pfp_s3_key": pfp_s3_key } };
        const result = await users.updateOne({ _id: usr.id }, update_op).catch((err) => {
            send_upload_pfp_err_response(res, default_pfp, "Could not update profile pic: " + err.message);
            return;
        });

        if (!result) {
            send_upload_pfp_err_response(res, default_pfp, "No result from updating profile pic");
            return;
        }

        if (result.acknowledged && result.matchedCount == 1) {
            const s3_key = `${usr.id.toString()}.webp`;
            const cmd = new PutObjectCommand({
                Bucket: config.s3_profile_pics_bucket,
                Key: s3_key,
                Body: data,
                ContentType: "image/webp",
            });
            ilog("Uploading profile pic for user ", usr.id, " to S3 key ", s3_key);

            await s3.send(cmd).catch((err) => {
                send_upload_pfp_err_response(res, default_pfp, "Error uploading image: " + err.message);
                return;
            });

            ilog("Uploaded profile pic for user ", usr.id);
            send_upload_pfp_err_response(res, pfp_s3_key, null);
        } else if (result.acknowledged) {
            send_upload_pfp_err_response(res, default_pfp, "Server error - logged in user not matched");
        }
    };

    const update_profile = (req: Request, res: Response) => {
        const usr = req.liuser as liuser_payload;
        const public_name = req.body.public_name;
        const about = req.body.about;
        const update_op = {
            $set: {
                "profile.public_name": public_name,
                "profile.about": about,
            },
        };

        const on_update_resolved = (result: UpdateResult<ss_user>) => {
            if (result.acknowledged && result.matchedCount == 1) {
                ilog(`Updated user ${usr.id} profile.public_name to ${public_name} and about to ${about}`);
                send_update_profile_response(res, null);
            } else if (result.acknowledged) {
                wlog("Server error - could not match", usr.id, " in users to update profile");
                send_update_profile_response(res, "Server error - logged in user not matched");
            }
        };

        const on_update_rejected = (err: any) => {
            wlog("Update error:", err.message);
            send_update_profile_response(res, "There was a problem with the update: " + err.message);
        };

        const update_prom = users.updateOne({ _id: usr.id }, update_op);
        update_prom.then(on_update_resolved, on_update_rejected);
    };

    const profile_router = Router();
    profile_router.get("/profile", verify_liuser, edit_profile);
    profile_router.post("/profile", verify_liuser, update_profile);
    profile_router.post("/profile/pic", verify_liuser, multer_profile_func, upload_pfp);
    return profile_router;
}
