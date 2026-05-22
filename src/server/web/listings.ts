import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import { verify_liuser, type liuser_payload } from "./auth.js";
import { make_http_error, rethrow_http_error } from "./error.js";
import { Collection, ObjectId } from "mongodb";
import mongo from "../db.js";
import { type ss_listing } from "../models/ss_listing.js";
import template from "../template.js";

const GET_DRAFT_SCHEMA = {
    params: {
        type: "object",
        properties: {
            id: { type: "string" },
        },
        required: ["id"],
    },
} as const;

function create_default_listing(liuser_id: string): ss_listing {
    return {
        _id: new ObjectId().toString(),
        seller_id: liuser_id,

        // Yarn details
        title: "",
        description: "",
        price: 0,
        status: "draft",

        brand: "",
        yarn_name: "",
        color: "",
        fiber: "",
        weight: "unknown",
        quantity: 1,
        condition: "unknown",

        photos: [],

        created_at: new Date(),
        updated_at: new Date(),
    };
}

async function insert_listing(draft: ss_listing, listings: Collection<ss_listing>) {
    try {
        const listing = await listings.insertOne(draft);
        if (listing.insertedId != draft._id) {
            throw make_http_error(`Unexpected id ${listing.insertedId} returned (expected ${draft._id})`, 500);
        }
    } catch (err: any) {
        rethrow_http_error(err);
        throw make_http_error("Failed to insert: " + err.msg, 500);
    }
}

async function get_listing(id: string, listings: Collection<ss_listing>): Promise<ss_listing> {
    try {
        const listing = await listings.findOne({ _id: id });
        if (!listing) {
            throw make_http_error(`Could not find listing with id ${id}`, 404);
        }
        return listing;
    } catch (err: any) {
        rethrow_http_error(err);
        throw make_http_error(`Could not find listing with id ${id}`, 404);
    }
}

type route_params = { Params: { id: string } };

async function handle_get_edit_listing_by_id(request: FastifyRequest<route_params>, reply: FastifyReply) {
    const listings = mongo.get_listings();
    const { id } = request.params;
    const listing = await get_listing(id, listings);
    const photo_thumb_section = `<div class="photo-thumb">Photo1</div><div class="photo-thumb">Photo2</div><div class="photo-thumb">Photo3</div>`;
    const html_page = template.render_page_layout("edit-listing", { photo_thumb_section });
    reply.type("text/html").send(html_page);
}

// This will create the listing draft and redirect right away to the edit page for it. This is better than returning a "new listing"
// form because then we can make partial edits in order to auto save stuff
async function handle_post_listing_draft(request: FastifyRequest, reply: FastifyReply) {
    const listings = mongo.get_listings();
    const usr = request.liuser as liuser_payload;
    const draft_listing = create_default_listing(usr.id);
    await insert_listing(draft_listing, listings);
    reply.redirect(`/listings/${draft_listing._id}/edit`);
}

export function create_listing_routes(): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });
        fastify.post("/listings", { preHandler: verify_liuser }, handle_post_listing_draft);
        fastify.get<route_params>(
            "/listings/:id/edit",
            { preHandler: verify_liuser, schema: GET_DRAFT_SCHEMA },
            handle_get_edit_listing_by_id
        );
    };
}
