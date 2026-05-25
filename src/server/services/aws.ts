import config from "../config.js";
import { make_http_error } from "../web/error.js";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost, type PresignedPostOptions, type PresignedPost } from "@aws-sdk/s3-presigned-post";

const s3 = new S3Client({ region: config.aws.s3_region });

function get_s3(): S3Client {
    return s3;
}
const KB_SIZE = 1024;
const MB_SIZE = KB_SIZE * KB_SIZE;

function get_length_info(data: Buffer | Uint8Array) {
    const sz_info =
        data.length > MB_SIZE ? { sz: data.length / MB_SIZE, lbl: "MB" } : { sz: data.length / KB_SIZE, lbl: "KB" };
    return sz_info;
}

async function download_from_s3(key: string): Promise<{file: Buffer, content_type: string}> {
    const cmd = new GetObjectCommand({
        Bucket: config.aws.s3_bucket,
        Key: key,
    });
    try {
        const result = await s3.send(cmd);
        if (!result.Body) throw make_http_error(`S3 returned no body for key ${key}`, 500);
        const data = await result.Body.transformToByteArray();
        const sz_info = get_length_info(data);
        ilog(`Downloaded ${sz_info.sz}${sz_info.lbl} file from ${key}`);
        return {file: Buffer.from(data.buffer, data.byteOffset, data.byteLength), content_type: result.ContentType};
    } catch (err: any) {
        if (err?.name === "NoSuchKey") {
            throw make_http_error(`No such aws key ${key} found`, 404);
        }
        throw make_http_error(`S3 download failed: ${err.message}`, 500);
    }
}

async function delete_from_s3(key: string): Promise<void> {
    const cmd = new DeleteObjectCommand({
        Bucket: config.aws.s3_bucket,
        Key: key,
    });
    try {
        await s3.send(cmd);
        ilog(`Deleted ${key}`);
    } catch (err: any) {
        if (err?.name === "NoSuchKey") {
            throw make_http_error(`No such aws key ${key} found`, 404);
        }
        throw make_http_error(`S3 deletion failed: ${err.message}`, 500);
    }
}

async function upload_to_s3(key: string, data: Buffer, mimetype: string): Promise<void> {
    const cmd = new PutObjectCommand({
        Bucket: config.aws.s3_bucket,
        Key: key,
        Body: data,
        ContentType: mimetype,
    });

    try {
        await s3.send(cmd);
        const sz_info = get_length_info(data);
        ilog(`Uploaded ${sz_info.sz}${sz_info.lbl} file of type ${mimetype} to ${key}`);
    } catch (err: any) {
        throw make_http_error("S3 upload failed: " + err.message, 500);
    }
}

async function create_put_url(key: string, content_type: string): Promise<string> {
    const command = new PutObjectCommand({
        Bucket: config.aws.s3_bucket,
        Key: key,
        ContentType: content_type,
    });

    const url = await getSignedUrl(s3, command, {
        expiresIn: 60, // seconds
    });
    return url;
}

async function create_post_image_url(key: string, content_type: string): Promise<PresignedPost> {
    const command: PresignedPostOptions = {
        Bucket: config.aws.s3_bucket,
        Key: key,
        Fields: {
            "Content-Type": content_type,
        },
        Conditions: [
            ["content-length-range", 0, 10 * 1024 * 1024],
            ["starts-with", "$key", config.aws.s3_tmp_pics_pf],
        ],
        Expires: 60,
    };
    const presigned_post = await createPresignedPost(s3, command);
    return presigned_post;
}

const aws = {
    get_s3,
    upload_to_s3,
    download_from_s3,
    delete_from_s3,
    create_put_url,
    create_post_image_url,
};

export default aws;
