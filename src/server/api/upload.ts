import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { verify_liuser, type liuser_payload } from "../web/auth.js";
import crypto from "crypto";
import aws from "../services/aws.js";
import config from "../config.js";

async function handle_get_postimageurl(
    request: FastifyRequest,
    reply: FastifyReply
) {
    const { id } = request.liuser as liuser_payload;
    const prefix = crypto.randomBytes(16).toString("hex");
    const key = `${config.aws.s3_listing_pics_pf}/${id}/${prefix}`;
    const presigned = await aws.create_post_image_url(key);
    reply.send(presigned);
}

export function create_upload_api_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.get(
            "/api/upload/postimageurl",
            { preHandler: verify_liuser },
            handle_get_postimageurl
        );
    };
}
