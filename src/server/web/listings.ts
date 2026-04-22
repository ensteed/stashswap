import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { MongoClient, Collection, type UpdateResult, type UpdateFilter, ObjectId } from "mongodb";
import fastifyMultipart from "@fastify/multipart";
import { config } from "../config.js";
import { verify_liuser, type liuser_payload } from "./auth.js";
import { make_http_error, rethrow_http_error } from "./error.js";
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

export type yarn_weight = "lace" | "fingering" | "dk" | "worsted" | "bulky" | "super_bulky" | "unknown";

export type listing_condition = "new_original" | "new_wound" | "partial" | "used" | "unknown";
export type listing_status = "draft" | "active" | "sold" | "archived";

export interface listing_photo {
    url: string;
    sortOrder: number;
    alt?: string;
}

export interface ss_listing {
    _id: string;
    seller_id: string;

    title: string;
    description: string;
    price: number;
    status: listing_status;

    brand?: string;
    yarn_name?: string;
    color?: string;
    fiber?: string;
    weight?: yarn_weight;
    quantity?: number;
    condition?: listing_condition;

    photos: listing_photo[];

    created_at: Date;
    updated_at: Date;
}

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

export function create_listing_routes(mongo_client: MongoClient): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });
        const db = mongo_client.db(config.mongo.db);
        const listings = db.collection<ss_listing>(config.mongo.listings);

        const get_edit_listing_view = async (
            request: FastifyRequest<{ Params: { id: string } }>,
            reply: FastifyReply
        ) => {
            const { id } = request.params;
            const listing = await get_listing(id, listings);
            const html_page = template.render_page_layout("edit-listing", { listing_name: listing._id });
            reply.type("html").send(html_page);
        };

        // This will create the listing draft and redirect right away to the edit page for it. This is better than returning a "new listing"
        // form because then we can make partial edits in order to auto save stuff
        const create_listing_draft = async (request: FastifyRequest, reply: FastifyReply) => {
            const usr = request.liuser as liuser_payload;
            const draft_listing = create_default_listing(usr.id);
            await insert_listing(draft_listing, listings);
            reply.redirect(`/listings/${draft_listing._id}/edit`);
        };

        fastify.post("/listings", { preHandler: verify_liuser }, create_listing_draft);
        fastify.get<{ Params: { id: string } }>(
            "/listings/:id/edit",
            { preHandler: verify_liuser, schema: GET_DRAFT_SCHEMA },
            get_edit_listing_view
        );
    };
}
