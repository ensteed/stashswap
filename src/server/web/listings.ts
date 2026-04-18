import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { MongoClient, Collection, type UpdateResult, type UpdateFilter } from "mongodb";
import fastifyMultipart from "@fastify/multipart";
import { config } from "../config.js";
import { verify_liuser } from "./auth.js";

export type yarn_weight =
    | "lace"
    | "fingering"
    | "sport"
    | "dk"
    | "worsted"
    | "bulky"
    | "super_bulky"
    | "jumbo"
    | "other";

export type listing_condition = "new_never_wound" | "new_wound_cake" | "lightly_used" | "partial_skein";

export type home_environment = "smoke_free_pet_free" | "smoke_free_pet_friendly" | "not_specified";

export type listing_category = "yarn" | "fiber_roving" | "needles_hooks" | "patterns" | "notions" | "kits";

export type shipping_method = "usps_first_class" | "usps_priority" | "other";

export type processing_time = "1_business_day" | "2_business_days" | "3_5_business_days" | "1_week";

export type trade_policy = "not_accepted" | "maybe" | "accepted";

export type listing_status = "draft" | "active" | "sold" | "archived";

export interface ss_listing {
    id: string;
    seller_id: string;
    status: listing_status;
    created_at: Date;
    updated_at: Date;

    // Photos
    photo_urls: string[];
    cover_photo_index: number;

    // Yarn details
    title: string;
    brand: string;
    yarn_line: string;
    colorway: string;
    weight: yarn_weight;
    fiber_content: string;
    yardage_per_skein: number;
    grams_per_skein: number;
    dye_lot: string;

    // Condition & quantity
    condition: listing_condition;
    home_environment: home_environment;
    quantity: number;
    category: listing_category;

    // Pricing & shipping
    price_per_skein: number;
    shipping_cost: number;
    processing_time: processing_time;
    shipping_method: shipping_method;

    // Description & tags
    description: string;
    tags: string[];
    trades: trade_policy;
}

export function create_profile_routes(mongo_client: MongoClient): FastifyPluginAsync {
    return async (fastify: FastifyInstance) => {
        await fastify.register(fastifyMultipart, { limits: { fileSize: 4 * 1024 * 1024 } });

        const db = mongo_client.db(config.mongo.db);
        const users = db.collection<ss_listing>(config.mongo.listings);

        const get_create_listing_view = async (request: FastifyRequest, reply: FastifyReply) => {
        };

        const post_listing = async (request: FastifyRequest, reply: FastifyReply) => {
        };

        fastify.get("/listings/new", { preHandler: verify_liuser }, get_create_listing_view);
        fastify.post("/listings", { preHandler: verify_liuser }, post_listing);
    };
}
