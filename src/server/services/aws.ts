import config from "../config.js";
import { make_http_error } from "../web/error.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost, type PresignedPostOptions } from "@aws-sdk/s3-presigned-post";

const s3 = new S3Client({ region: config.aws.s3_region });

function get_s3(): S3Client {
    return s3;
}

async function upload_to_s3(key: string, data: Buffer, mimetype: string) {
    const cmd = new PutObjectCommand({
        Bucket: config.aws.s3_bucket,
        Key: key,
        Body: data,
        ContentType: mimetype,
    });

    try {
        await s3.send(cmd);
        ilog(`Uploaded ${key} (${mimetype}) to bucket ${config.aws.s3_bucket} (${data.buffer.byteLength} bytes)`);
    } catch (err: any) {
        throw make_http_error("S3 upload failed: " + err.message, 500);
    }
}

async function create_put_url(key: string, content_type: string) {
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

async function create_post_image_url(key: string, content_type: string) {
    const command: PresignedPostOptions = {
        Bucket: config.aws.s3_bucket,
        Key: key,
        Fields: {
            "Content-Type": content_type
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
    create_put_url,
    create_post_image_url,
};

export default aws;
