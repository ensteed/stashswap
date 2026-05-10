import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { verify_liuser } from "../web/auth.js";
import crypto from "crypto";
import aws from "../services/aws.js";
import config from "../config.js";

async function handle_get_listing_presigned_url(
    request: FastifyRequest<{ Params: { id: string; fname: string } }>,
    reply: FastifyReply
) {
    const { id, fname } = request.params;
    const prefix = crypto.randomBytes(16).toString("hex");
    const key = `${config.aws.s3_listing_pics_pf}/${id}/${prefix}-${fname}`;
    const presigned = await aws.create_presigned_post_url(key);
    reply.send(presigned);
}

export function create_listing_api_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        fastify.get<{ Params: { id: string; fname: string } }>(
            "/api/listings/:id/postimageurl",
            { preHandler: verify_liuser },
            handle_get_listing_presigned_url
        );
    };
}
